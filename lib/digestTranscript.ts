/**
 * One transcript → one structured CallDigest — the map/reduce engine, factored out of
 * scripts/refresh-call-digests so BOTH the nightly desk digest AND the historical backfill's overnight rig
 * ingestion (scripts/ingest-transcripts) run the SAME prompts through whatever LLM the caller passes (cloud
 * flash for the desk, the local vLLM for the backfill via CALL_DIGEST_LOCAL_*). Chunk → per-segment notes →
 * reduce to a digest → sanitize/verify (grounded quotes + figures). Provider-agnostic: the `llm` arg carries
 * the model + local flag + timeouts; nothing here is desk- or rig-specific.
 */
import { chatJSON, NO_ADVICE } from "./llm";
import { chunkTranscript, sanitizeDigest, CHUNK_CHARS, MAX_CHUNKS, type CallDigest } from "./callDigests";

export interface DigestInput {
  symbol: string;
  name: string;
  sector: string | null;
  marketCap: number | null;
  title: string;
  date: string | null; // the transcript's own call date (YYYY-MM-DD)
  url: string;
  source: string;
  text: string; // the full raw transcript
}
/** The LLM knobs chatJSON needs, chosen by the caller (desk = cloud flash; backfill = local vLLM). */
export interface DigestLlm { model: string; local?: boolean; reasoningEffort?: "low" | "medium" | "high"; timeoutMs?: number; retries?: number }

const NOTES_SYSTEM =
  "You are an equity-research associate taking STRUCTURED NOTES on one SEGMENT of an earnings-call transcript (the segment may begin or end mid-call). Record ONLY what this segment states: the key points; the explicitly quantified figures WITH their context, copied exactly (never compute, annualize or infer a number); guidance statements verbatim; and each analyst Q&A exchange (analyst and firm if named, the gist of the question, the gist of the answer, and directness = direct | partial | evasive). One line on management's tone. Up to 3 SHORT verbatim quotes. Keep it TIGHT — at most 10 key points, 14 figures, 6 guidance lines, 6 exchanges, each item one sentence — the reply must be complete JSON. Return ONLY JSON. " +
  NO_ADVICE;
const NOTES_SCHEMA =
  'Return ONLY JSON: {"keyPoints": string[], "numbers": string[], "guidance": string[], "qa": [{"analyst": string, "question": string, "answer": string, "directness": "direct"|"partial"|"evasive"}], "tone": string, "quotes": [{"speaker": string, "text": string}]}';
const DIGEST_SYSTEM =
  "You are a buy-side desk analyst writing the morning DIGEST of one company's earnings call for a portfolio manager who did not listen. You are given the full transcript, or structured notes from its segments. Write: " +
  "'tldr' — 1-2 sentences: the single thing that matters from this call. " +
  "'tone' — upbeat | measured | cautious | defensive. " +
  "'guidance' — {action: raised | reaffirmed | cut | initiated | withdrawn | mixed | none, detail: the guided figures/language in one line}. " +
  "'kpis' — 3-6 quantified facts from the call, each with its number EXACTLY as stated. " +
  "'drivers' — 2-4 lines on what drove the quarter: demand, pricing, margins/costs, capital allocation. " +
  "'qa' — the 3-5 sharpest analyst exchanges: analyst/firm if named, the gist of the question, the gist of the answer, directness = direct | partial | evasive. " +
  "'readThrough' — 1-3 implications for peers, suppliers or customers (name a ticker only when certain). " +
  "'watch' — 1-3 things to check next quarter. " +
  "'quotes' — up to 3 SHORT verbatim quotes with the speaker, copied EXACTLY (a paraphrase is rejected by code). " +
  "Ground everything in the supplied text; never invent a figure. Return ONLY JSON. " +
  NO_ADVICE;
const DIGEST_SCHEMA =
  'Return ONLY JSON: {"tldr": string, "tone": "upbeat"|"measured"|"cautious"|"defensive", "guidance": {"action": "raised"|"reaffirmed"|"cut"|"initiated"|"withdrawn"|"mixed"|"none", "detail": string}, "kpis": string[], "drivers": string[], "qa": [{"analyst": string, "question": string, "answer": string, "directness": "direct"|"partial"|"evasive"}], "readThrough": string[], "watch": string[], "quotes": [{"speaker": string, "text": string}]}';

/** Digest one transcript. `modelLabel` is stamped on the digest's `model` field; `debug` logs each stage. */
export async function digestTranscript(input: DigestInput, llm: DigestLlm, modelLabel: string, sessionDay: string, debug = false): Promise<CallDigest | null> {
  const chunks = chunkTranscript(input.text, CHUNK_CHARS).slice(0, MAX_CHUNKS);
  const head = `${input.name} (${input.symbol}) — ${input.title} (${input.date || sessionDay})`;
  let raw: unknown;
  if (chunks.length === 1) {
    raw = await chatJSON<unknown>(DIGEST_SYSTEM, `${DIGEST_SCHEMA}\n\n=== TRANSCRIPT: ${head} ===\n${chunks[0]}`, { ...llm, maxTokens: 3200 });
  } else {
    const notes: unknown[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const n = await chatJSON<unknown>(NOTES_SYSTEM, `${NOTES_SCHEMA}\n\n=== ${head} — SEGMENT ${i + 1} of ${chunks.length} ===\n${chunks[i]}`, { ...llm, maxTokens: 3500 });
      if (!n) { if (debug) console.log(`    ${input.symbol}: notes segment ${i + 1}/${chunks.length} came back null (transport or invalid JSON)`); return null; } // an incomplete read — retry rather than digest half a call
      notes.push(n);
    }
    raw = await chatJSON<unknown>(
      DIGEST_SYSTEM,
      `${DIGEST_SCHEMA}\n\n=== ${head} — STRUCTURED NOTES FROM ${chunks.length} SEGMENTS (in call order) ===\n${notes.map((n, i) => `--- segment ${i + 1} ---\n${JSON.stringify(n)}`).join("\n")}`,
      { ...llm, maxTokens: 3200 },
    );
  }
  return sanitizeDigest(raw, input.text, {
    symbol: input.symbol, name: input.name, sector: input.sector, marketCap: input.marketCap,
    callDate: input.date || sessionDay, title: input.title, url: input.url, source: input.source,
    chars: input.text.length, chunks: chunks.length, model: modelLabel, digestedAt: new Date().toISOString(),
  });
}
