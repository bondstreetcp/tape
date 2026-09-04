/**
 * Builds data/call-digests.json — a digest of EVERY earnings-call transcript from the last session, read in
 * full on the desk's LOCAL box (the EPYC/3090 server behind LLM_LOCAL_*; the cloud default tier is the
 * fallback when the box is offline), plus the cross-call synthesis the Daily Desk and the desk brief use.
 * Data model + the pure helpers: lib/callDigests.ts.
 *
 *   npm run refresh-call-digests
 *
 * Runs on the desk ticks (08:00 / 17:00 ET) and the nightly FULL tick, BEFORE the desk note. Wall-clock
 * BUDGETED (a 45-min step kill writes nothing): names not reached are deferred and simply picked up by the
 * next tick — every digest is keyed by (symbol, call date), so nothing is read twice. The 08:00 ET run is
 * the one that catches last night's after-close calls (transcripts post within a few hours).
 *
 * WHO REPORTED: US names (S&P 500 ∪ Nasdaq 100 ∪ Russell 1000) whose earnings date falls in the window, ∪
 * results 8-Ks from the overnight-filings feed. Each candidate is VERIFIED against The Motley Fool's
 * transcript listing (a transcript dated in the window) before a single fetch or model call is spent.
 *
 * Knobs: CALL_DIGEST_BUDGET_MIN (30) · CALL_DIGEST_CAP (30 transcripts/run, largest caps first) ·
 * CALL_DIGEST_CONCURRENCY (3 — vLLM batches; the box is the ceiling, not the wire) ·
 * CALL_DIGEST_LOCAL_ONLY=1 (skip when the box isn't configured, and never fall back to cloud) ·
 * TEST_SYMBOLS="AAPL MSFT" · FORCE=1 (re-digest calls already stored).
 */
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot } from "../lib/data";
import { loadOvernightFilings, isMassLlmFailure } from "../lib/overnightFilings";
import { listTranscriptCandidates, fetchTranscriptAt, type FullTranscript } from "../lib/transcripts";
import { chatJSON, NO_ADVICE, llmConfigured } from "../lib/llm";
import { writeFeedGuarded } from "../lib/feedGuard";
import {
  CHUNK_CHARS, MAX_CHUNKS, chunkTranscript, isRecentCallDate, mergeDigests, sanitizeDigest, sanitizeSynthesis, sessionWindow,
  type CallDigest, type CallDigestsData, type CallSynthesis,
} from "../lib/callDigests";

const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "call-digests.json");
const US_UNIVERSES = ["sp500", "nasdaq100", "russell1000"];
const BUDGET_MIN = Number(process.env.CALL_DIGEST_BUDGET_MIN || 30);
const CAP = Number(process.env.CALL_DIGEST_CAP || 30);
const CONC = Math.max(1, Number(process.env.CALL_DIGEST_CONCURRENCY || 3));
const LOCAL_CONFIGURED = !!(process.env.LLM_LOCAL_BASE_URL && process.env.LLM_LOCAL_MODEL);
const LOCAL_ONLY = process.env.CALL_DIGEST_LOCAL_ONLY === "1";
const FORCE = process.env.FORCE === "1";
const TEST = (process.env.TEST_SYMBOLS || "").split(/[\s,]+/).filter(Boolean).map((s) => s.toUpperCase());
const KEEP = 160; // ~a week of peak-season sessions
const MIN_CHARS = 3000; // shorter than this is a stub page, not a call
const HOUR = 3_600_000;
// The label stored on each digest. chatJSON serves attempt 0 locally when the box is configured and falls
// through to the cloud default tier on a failure — the response doesn't say which, so the label is honest
// about the arrangement rather than claiming a model per row.
const MODEL_LABEL = LOCAL_CONFIGURED ? `local:${process.env.LLM_LOCAL_MODEL}${LOCAL_ONLY ? "" : " (cloud fallback)"}` : "cloud default tier (LLM_LOCAL_* unset)";
// LOCAL_ONLY: attempt 0 is the local box; with retries=1 there is no attempt 1, so no cloud spend — a
// transient box error just leaves that call for the next tick.
const LLM = { local: true as const, timeoutMs: 300_000, retries: LOCAL_ONLY ? 1 : 3 };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; try { out[i] = await fn(items[i]); } catch { out[i] = null as any; } }
  }));
  return out;
}

// ── prompts ─────────────────────────────────────────────────────────────────────────────────────
const NOTES_SYSTEM =
  "You are an equity-research associate taking STRUCTURED NOTES on one SEGMENT of an earnings-call transcript (the segment may begin or end mid-call). Record ONLY what this segment states: the key points; every explicitly quantified figure WITH its context, copied exactly (never compute, annualize or infer a number); guidance statements verbatim; and each analyst Q&A exchange (analyst and firm if named, the gist of the question, the gist of the answer, and directness = direct | partial | evasive). One line on management's tone. Up to 3 SHORT verbatim quotes. Return ONLY JSON. " +
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

const SYNTH_SYSTEM =
  "You are the desk strategist. You are given the digests of every earnings call from the last session. Write the CROSS-CALL read for the morning brief: 'tldr' (1-2 sentences — what yesterday's calls, taken together, said about the economy and the tape) and 'themes' (3-6; each: 'heading' ≤ 10 words, 'detail' 2-3 sentences citing the specific companies and figures, 'tickers' = the symbols cited, ONLY from the supplied list). Prefer themes that cut ACROSS companies — consumer demand, pricing power, AI spend, tariffs and costs, guidance posture — and call out genuine divergences. Return ONLY JSON. " +
  NO_ADVICE;
const SYNTH_SCHEMA = 'Return ONLY JSON: {"tldr": string, "themes": [{"heading": string, "detail": string, "tickers": string[]}]}';

// ── one transcript → one digest (map over ≤ CHUNK_CHARS segments, then reduce; one chunk = one call) ──
interface Cand { symbol: string; name: string; sector: string | null; marketCap: number | null; why: string }

async function digestOne(c: Cand, tr: FullTranscript, sessionDay: string): Promise<CallDigest | null> {
  const chunks = chunkTranscript(tr.text, CHUNK_CHARS).slice(0, MAX_CHUNKS);
  const head = `${c.name} (${c.symbol}) — ${tr.title} (${tr.date || sessionDay})`;
  let raw: unknown;
  if (chunks.length === 1) {
    raw = await chatJSON<unknown>(DIGEST_SYSTEM, `${DIGEST_SCHEMA}\n\n=== TRANSCRIPT: ${head} ===\n${chunks[0]}`, { ...LLM, maxTokens: 2200 });
  } else {
    const notes: unknown[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const n = await chatJSON<unknown>(NOTES_SYSTEM, `${NOTES_SCHEMA}\n\n=== ${head} — SEGMENT ${i + 1} of ${chunks.length} ===\n${chunks[i]}`, { ...LLM, maxTokens: 1800 });
      if (!n) return null; // a missing segment is an incomplete read — retry next tick rather than digest half a call
      notes.push(n);
    }
    raw = await chatJSON<unknown>(
      DIGEST_SYSTEM,
      `${DIGEST_SCHEMA}\n\n=== ${head} — STRUCTURED NOTES FROM ${chunks.length} SEGMENTS (in call order) ===\n${notes.map((n, i) => `--- segment ${i + 1} ---\n${JSON.stringify(n)}`).join("\n")}`,
      { ...LLM, maxTokens: 2200 },
    );
  }
  return sanitizeDigest(raw, tr.text, {
    symbol: c.symbol, name: c.name, sector: c.sector, marketCap: c.marketCap,
    callDate: tr.date || sessionDay, title: tr.title, url: tr.url, source: tr.source,
    chars: tr.text.length, chunks: chunks.length, model: MODEL_LABEL, digestedAt: new Date().toISOString(),
  });
}

async function synthesize(rows: CallDigest[], sessionDay: string): Promise<CallSynthesis | null> {
  const lines = rows.slice(0, 40).map((d) =>
    `${d.symbol} (${d.name}; ${d.sector ?? "sector ?"}; tone ${d.tone}; guidance ${d.guidance.action}${d.guidance.detail ? `: ${d.guidance.detail}` : ""}): ${d.tldr}` +
    (d.kpis.length ? ` | KPIs: ${d.kpis.slice(0, 3).join("; ")}` : "") +
    (d.readThrough.length ? ` | read-through: ${d.readThrough.join("; ")}` : ""));
  const raw = await chatJSON<unknown>(
    SYNTH_SYSTEM,
    `${SYNTH_SCHEMA}\n\nSESSION: ${sessionDay}. ${rows.length} calls digested. TICKERS YOU MAY CITE: ${rows.map((d) => d.symbol).join(", ")}\n\n=== DIGESTS ===\n${lines.join("\n")}`,
    { ...LLM, maxTokens: 1800 },
  );
  return sanitizeSynthesis(raw, rows.map((d) => d.symbol), { sessionDay, n: rows.length, model: MODEL_LABEL, generatedAt: new Date().toISOString() });
}

const emptyFile = (nowISO: string): CallDigestsData => ({
  generatedAt: nowISO, digests: [], synthesis: null,
  lastRun: { sessionDay: "", candidates: 0, withTranscript: 0, digested: 0, deferred: 0, llmFails: 0, budgetMin: BUDGET_MIN, local: LOCAL_CONFIGURED },
});

async function readPrior(nowISO: string): Promise<CallDigestsData> {
  return fsp.readFile(FILE, "utf8").then((s) => JSON.parse(s) as CallDigestsData).catch((e: any) => {
    // ENOENT is a first run; any other read/parse failure must not wipe the archive (the one-bad-read class).
    if (e?.code === "ENOENT") return emptyFile(nowISO);
    console.error(`call-digests: ${FILE} exists but is unreadable (${e?.code ?? "parse error"}) — refusing to overwrite the archive.`);
    return process.exit(1);
  });
}

async function main() {
  const t0 = Date.now();
  const nowISO = new Date(t0).toISOString();
  if (!(await llmConfigured())) {
    const exists = await fsp.access(FILE).then(() => true, () => false);
    if (!exists) await fsp.writeFile(FILE, JSON.stringify(emptyFile(nowISO)));
    console.log(`call-digests: no LLM configured — skipping${exists ? " (prior file stands)" : " (seeded an empty file)"}.`);
    return;
  }
  if (LOCAL_ONLY && !LOCAL_CONFIGURED) {
    console.log("call-digests: CALL_DIGEST_LOCAL_ONLY=1 but LLM_LOCAL_BASE_URL/LLM_LOCAL_MODEL are not set — skipping (prior file stands).");
    return;
  }
  const w = sessionWindow(t0);
  const prior = await readPrior(nowISO);
  const have = new Set(prior.digests.map((d) => `${d.symbol}|${d.callDate}`));
  const doneSyms = new Set(prior.digests.filter((d) => d.callDate >= w.sessionDay).map((d) => d.symbol));

  // ── candidates: the calendar (snapshot earnings dates) ∪ results 8-Ks (overnight filings) ──
  const cand = new Map<string, Cand>();
  const stockBySym = new Map<string, { name: string; sector: string | null; marketCap: number | null }>();
  for (const uni of US_UNIVERSES) {
    const snap = await loadSnapshot(uni).catch(() => null);
    for (const s of snap?.stocks ?? []) {
      if (!stockBySym.has(s.symbol)) stockBySym.set(s.symbol, { name: s.name, sector: s.sector || null, marketCap: s.marketCap ?? null });
      if (TEST.length && !TEST.includes(s.symbol)) continue;
      const e = s.earningsDate ? Date.parse(s.earningsDate) : NaN;
      if (!Number.isFinite(e) || e < w.since - 6 * HOUR || e > t0 + 3 * HOUR) continue;
      if (!cand.has(s.symbol)) cand.set(s.symbol, { symbol: s.symbol, name: s.name, sector: s.sector || null, marketCap: s.marketCap ?? null, why: "calendar" });
    }
  }
  const overnight = await loadOvernightFilings().catch(() => null);
  for (const it of overnight?.items ?? []) {
    if (!it?.ticker || (TEST.length && !TEST.includes(it.ticker))) continue;
    const f = Date.parse(it.filedAt);
    if (!Number.isFinite(f) || f < w.since) continue;
    const results = it.surprise !== "na" || (/^8-K/.test(it.form) && /\b(results|quarter|earnings|fiscal)\b/i.test(it.headline || ""));
    if (!results || cand.has(it.ticker)) continue;
    const st = stockBySym.get(it.ticker);
    cand.set(it.ticker, { symbol: it.ticker, name: it.name || st?.name || it.ticker, sector: st?.sector ?? null, marketCap: st?.marketCap ?? null, why: "8-K" });
  }
  for (const s of TEST) if (!cand.has(s)) { const st = stockBySym.get(s); cand.set(s, { symbol: s, name: st?.name || s, sector: st?.sector ?? null, marketCap: st?.marketCap ?? null, why: "test" }); }

  const pending = [...cand.values()].filter((c) => FORCE || !doneSyms.has(c.symbol)).sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  console.log(`call-digests: session ${w.sessionDay} (window since ${new Date(w.since).toISOString()}) · ${cand.size} reporters (${doneSyms.size} already digested) → ${pending.length} to verify · ${MODEL_LABEL}`);

  // ── verify: a transcript dated in the window, before any fetch/model spend ──
  let notPosted = 0;
  const verified = (await mapPool(pending, 4, async (c) => {
    const list = await listTranscriptCandidates(c.symbol, c.name).catch(() => []);
    const hit = list.find((t) => isRecentCallDate(t.date, w));
    await sleep(150);
    if (!hit) { notPosted++; return null; }
    if (!FORCE && have.has(`${c.symbol}|${hit.date}`)) return null;
    return { ...c, hit };
  })).filter((x): x is Cand & { hit: { url: string; date: string } } => !!x);
  console.log(`  ${verified.length} with a transcript dated ${w.sessionDay}..${w.today} (${notPosted} not posted yet — retried next tick)`);

  // ── digest under the wall-clock budget, largest caps first ──
  const work = verified.slice(0, CAP);
  let attempted = 0, llmFails = 0, unreadable = 0, deferred = verified.length - work.length;
  const fresh: CallDigest[] = [];
  const budgetMs = BUDGET_MIN * 60_000;
  await mapPool(work, CONC, async (c) => {
    if (Date.now() - t0 > budgetMs) { deferred++; return; }
    const tr = await fetchTranscriptAt(c.symbol, c.hit).catch(() => null);
    if (!tr || tr.text.length < MIN_CHARS) { unreadable++; console.log(`  ${c.symbol}: transcript unreadable (${tr?.text.length ?? 0} chars)`); return; }
    attempted++;
    const d = await digestOne(c, tr, w.sessionDay).catch(() => null);
    if (!d) { llmFails++; console.log(`  ${c.symbol}: digest failed/empty — will retry next tick`); return; }
    fresh.push(d);
    console.log(`  ${c.symbol.padEnd(6)} ${d.callDate} · ${Math.round(tr.text.length / 1000)}k chars / ${d.chunks} chunk(s) · ${d.tone} · guidance ${d.guidance.action} · ${d.tldr.slice(0, 100)}`);
  });
  if (isMassLlmFailure(attempted, llmFails, deferred)) {
    console.error(`call-digests: ${llmFails}/${attempted} digests failed (${deferred} deferred) — mass LLM failure; keeping last run's file.`);
    process.exit(1);
  }

  const digests = mergeDigests(prior.digests, fresh, KEEP);
  const sessionRows = digests.filter((d) => d.callDate >= w.sessionDay);
  let synthesis = prior.synthesis;
  if (sessionRows.length >= 2 && (fresh.length > 0 || !synthesis || synthesis.sessionDay !== w.sessionDay)) {
    const s = await synthesize(sessionRows, w.sessionDay).catch(() => null);
    if (s) synthesis = s;
    else console.warn("  synthesis failed/empty — prior synthesis stands");
  }

  const payload: CallDigestsData = {
    generatedAt: nowISO,
    digests,
    synthesis,
    lastRun: { sessionDay: w.sessionDay, candidates: cand.size, withTranscript: verified.length, digested: fresh.length, deferred, llmFails, budgetMin: BUDGET_MIN, local: LOCAL_CONFIGURED },
  };
  const wr = await writeFeedGuarded("call-digests.json", payload);
  console.log(
    `call-digests: ${wr.written ? "wrote" : "SKIPPED"} ${digests.length} digests (${sessionRows.length} this session; +${fresh.length} new, ${deferred} deferred, ${unreadable} unreadable, ${llmFails} failed) · synthesis ${synthesis ? `${synthesis.sessionDay} · ${synthesis.themes.length} themes` : "none"} · ${Math.round((Date.now() - t0) / 60_000)} min${wr.written ? "" : ` — ${wr.reason}`}`,
  );
}

main().catch((e) => { console.error("refresh-call-digests:", String(e?.message || e)); process.exit(1); });
