/**
 * Builds data/call-digests.json — a digest of EVERY earnings-call transcript from the last session, read in
 * full on the cloud FLASH tier (gemini-2.5-flash-lite — the model the overnight SEC-filings digests already
 * trust; ~$0.40 on a 100-call peak day), plus the cross-call synthesis (PRO tier — judgment work, one call a
 * run) the Daily Desk and the desk brief use. Data model + the pure helpers: lib/callDigests.ts.
 *
 *   npm run refresh-call-digests
 *
 * Runs on the desk ticks (08:00 / 17:00 ET) and the nightly FULL tick, BEFORE the desk note. Wall-clock
 * BUDGETED (a 45-min step kill writes nothing): names not reached are deferred and simply picked up by the
 * next tick — every digest is keyed by (symbol, call date), so nothing is read twice. The 08:00 ET run is
 * the one that catches last night's after-close calls (transcripts post within a few hours).
 *
 * WHO REPORTED: US names (S&P 500 ∪ Nasdaq 100 ∪ Russell 1000) whose earnings date falls in the last
 * CALL_DIGEST_LOOKBACK_DAYS (7), ∪ results 8-Ks from the overnight-filings feed — a week, because the
 * transcript SOURCES lag the call by hours to days (lib/transcriptSources: Investing.com same-day but
 * IP-blocked on some boxes; The Motley Fool ~a week late and thin since June 2026). A name is retried every
 * tick until a transcript appears, then digested once per call date.
 *
 * WHERE IT RUNS: on the NAS the fresh source is blocked, so a NAS run mostly logs "blocked" and digests what
 * Fool has. A clean-IP box (an office PC with .env.local) runs the same command with CALL_DIGEST_PUBLISH=1,
 * which merges its output into R2 site-data/call-digests.json; every NAS/web tick's data-from-r2 hydrates
 * that object (merged, never clobbered), so the Daily Desk shows the union.
 *
 * WHY CLOUD (decided 2026-09-04): each transcript is ~20k tokens IN — a prompt-processing workload — and a
 * peak day brings 60-150 of them. The rig's only GPU server (argus-vllm in LXC 102, one sequence at a time)
 * manages ~13 a day inside the tick budgets and blocks the argus judge while it reads; Apple-silicon minis
 * prefill at a few hundred tokens/s. Flash-lite reads one in under a minute, six at a time.
 *
 * OPT-IN LOCAL: CALL_DIGEST_LOCAL_URL + CALL_DIGEST_LOCAL_MODEL (+ _API_KEY) send THIS job alone to a local
 * OpenAI-compatible server — they become LLM_LOCAL_* for this process (lib/llm reads them per call), so the
 * rest of the fleet keeps its own setting. Left unset on the NAS.
 *
 * Knobs: CALL_DIGEST_BUDGET_MIN (default by tick: 12 on a desk tick, 40 on FULL, else 30 — the morning
 * desk note must not slip past the open) · CALL_DIGEST_CAP (30 transcripts/run, largest caps first) ·
 * CALL_DIGEST_CONCURRENCY (6 on cloud; 2 when scoped to a local one-sequence server) ·
 * CALL_DIGEST_LOCAL_ONLY=1 (skip when the box isn't configured, and never fall back to cloud) ·
 * CALL_DIGEST_LOOKBACK_DAYS (7) · CALL_DIGEST_PUBLISH=1 (merge + ship the file to R2) ·
 * TEST_SYMBOLS="AAPL MSFT" · FORCE=1 (re-digest calls already stored).
 */
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot } from "../lib/data";
import { loadOvernightFilings, isMassLlmFailure } from "../lib/overnightFilings";
import type { FullTranscript } from "../lib/transcripts";
import { findRecentTranscript, investingReachable } from "../lib/transcriptSources";
import { chatJSON, FLASH_MODEL, NO_ADVICE, PRO_MODEL, llmConfigured } from "../lib/llm";
import { writeFeedGuarded } from "../lib/feedGuard";
import { getObject, putObject, r2Configured } from "../lib/r2";
import {
  CHUNK_CHARS, MAX_CHUNKS, budgetMinutes, chunkTranscript, lookbackSince, mergeCallDigestFiles, mergeDigests, sanitizeDigest, sanitizeSynthesis, scopedLocalEnv, sessionWindow,
  type CallDigest, type CallDigestsData, type CallSynthesis,
} from "../lib/callDigests";

// SCOPED ROUTING — CALL_DIGEST_LOCAL_* become LLM_LOCAL_* for THIS process only (lib/llm reads the local
// config per call, so this assignment is all it takes). Must precede every env read below.
const SCOPED = scopedLocalEnv(process.env);
if (SCOPED) Object.assign(process.env, SCOPED);

const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "call-digests.json");
const US_UNIVERSES = ["sp500", "nasdaq100", "russell1000"];
const BUDGET_MIN = budgetMinutes(process.env.TAPE_TICK_MODE, process.env.CALL_DIGEST_BUDGET_MIN); // run-tick sets TAPE_TICK_MODE
const CAP = Number(process.env.CALL_DIGEST_CAP || 30);
const LOOKBACK_DAYS = Math.max(1, Number(process.env.CALL_DIGEST_LOOKBACK_DAYS || 7)); // the sources lag the call by hours to days
const PUBLISH = process.env.CALL_DIGEST_PUBLISH === "1"; // a clean-IP box ships its output to R2 for the NAS/site to hydrate
const R2_KEY = "site-data/call-digests.json"; // must match scripts/data-from-r2.ts
const LOCAL_CONFIGURED = !!(process.env.LLM_LOCAL_BASE_URL && process.env.LLM_LOCAL_MODEL);
// Cloud flash runs six wide. A one-sequence local vLLM (--max-num-seqs 1) serves the second request only after
// the first completes, so 2 keeps one queued and ready without stacking a third behind a ~100s generation.
const CONC = Math.max(1, Number(process.env.CALL_DIGEST_CONCURRENCY || (LOCAL_CONFIGURED ? 2 : 6)));
const LOCAL_ONLY = process.env.CALL_DIGEST_LOCAL_ONLY === "1";
const FORCE = process.env.FORCE === "1";
const TEST = (process.env.TEST_SYMBOLS || "").split(/[\s,]+/).filter(Boolean).map((s) => s.toUpperCase());
const KEEP = 160; // ~a week of peak-season sessions
const MIN_CHARS = 3000; // shorter than this is a stub page, not a call
const HOUR = 3_600_000;
// The label stored on each digest. chatJSON serves attempt 0 locally when the box is configured and falls
// through to the cloud default tier on a failure — the response doesn't say which, so the label is honest
// about the arrangement rather than claiming a model per row.
const MODEL_LABEL = LOCAL_CONFIGURED
  ? `local:${process.env.LLM_LOCAL_MODEL}${SCOPED ? " [scoped]" : ""}${LOCAL_ONLY ? "" : ` (cloud fallback ${FLASH_MODEL})`}`
  : `cloud:${FLASH_MODEL}`;
const SYNTH_MODEL_LABEL = `cloud:${PRO_MODEL}`;
// The per-transcript reads: FLASH on cloud. `local: true` is what lets CALL_DIGEST_LOCAL_* opt in (attempt 0
// goes to the box only when LLM_LOCAL_* is set — inert otherwise); LOCAL_ONLY's retries=1 means no cloud
// attempt. The local timeout allows a request queued behind another on a one-sequence server.
const LLM = { model: FLASH_MODEL, local: true as const, reasoningEffort: "low" as const, timeoutMs: LOCAL_CONFIGURED ? 600_000 : 180_000, retries: LOCAL_ONLY ? 1 : 3 };
// The cross-call synthesis is judgment work — one call a run, PRO tier, always cloud (~half a cent).
const SYNTH_LLM = { model: PRO_MODEL, local: false as const, reasoningEffort: "low" as const, timeoutMs: 180_000, retries: 3 };

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
  "You are an equity-research associate taking STRUCTURED NOTES on one SEGMENT of an earnings-call transcript (the segment may begin or end mid-call). Record ONLY what this segment states: the key points; the explicitly quantified figures WITH their context, copied exactly (never compute, annualize or infer a number); guidance statements verbatim; and each analyst Q&A exchange (analyst and firm if named, the gist of the question, the gist of the answer, and directness = direct | partial | evasive). One line on management's tone. Up to 3 SHORT verbatim quotes. Keep it TIGHT — at most 10 key points, 14 figures, 6 guidance lines, 6 exchanges, each item one sentence — the reply must be complete JSON. Return ONLY JSON. " +
  NO_ADVICE;
const DEBUG = process.env.CALL_DIGEST_DEBUG === "1"; // log each stage's raw reply shape and why a digest was rejected
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
  // Output budgets: the notes for a 34k-char segment ran to ~1.8k tokens and truncated at the old 1,800 cap
  // (invalid JSON → a null segment → the whole digest dropped, 2026-09-04). Generous caps; the prompts bound
  // the list lengths so a complete reply stays well inside them.
  let raw: unknown;
  if (chunks.length === 1) {
    raw = await chatJSON<unknown>(DIGEST_SYSTEM, `${DIGEST_SCHEMA}\n\n=== TRANSCRIPT: ${head} ===\n${chunks[0]}`, { ...LLM, maxTokens: 3200 });
  } else {
    const notes: unknown[] = [];
    for (let i = 0; i < chunks.length; i++) {
      const n = await chatJSON<unknown>(NOTES_SYSTEM, `${NOTES_SCHEMA}\n\n=== ${head} — SEGMENT ${i + 1} of ${chunks.length} ===\n${chunks[i]}`, { ...LLM, maxTokens: 3500 });
      if (!n) { if (DEBUG) console.log(`    ${c.symbol}: notes segment ${i + 1}/${chunks.length} came back null (transport or invalid JSON)`); return null; } // an incomplete read — retry next tick rather than digest half a call
      if (DEBUG) console.log(`    ${c.symbol}: notes ${i + 1}/${chunks.length} keys=${Object.keys(n as object).join(",")} · ${JSON.stringify(n).length} chars`);
      notes.push(n);
    }
    raw = await chatJSON<unknown>(
      DIGEST_SYSTEM,
      `${DIGEST_SCHEMA}\n\n=== ${head} — STRUCTURED NOTES FROM ${chunks.length} SEGMENTS (in call order) ===\n${notes.map((n, i) => `--- segment ${i + 1} ---\n${JSON.stringify(n)}`).join("\n")}`,
      { ...LLM, maxTokens: 3200 },
    );
  }
  if (DEBUG) {
    const r = raw as Record<string, any> | null;
    console.log(`    ${c.symbol}: digest raw ${r ? `keys=${Object.keys(r).join(",")} · tldr=${JSON.stringify(r.tldr ?? null).slice(0, 90)} · kpis=${r.kpis?.length ?? "-"} drivers=${r.drivers?.length ?? "-"} qa=${r.qa?.length ?? "-"} quotes=${r.quotes?.length ?? "-"}` : "null (transport or invalid JSON)"}`);
  }
  const d = sanitizeDigest(raw, tr.text, {
    symbol: c.symbol, name: c.name, sector: c.sector, marketCap: c.marketCap,
    callDate: tr.date || sessionDay, title: tr.title, url: tr.url, source: tr.source,
    chars: tr.text.length, chunks: chunks.length, model: MODEL_LABEL, digestedAt: new Date().toISOString(),
  });
  if (DEBUG && raw && !d) console.log(`    ${c.symbol}: sanitize rejected the reply — tldr was a shell, or fewer than 2 of kpis/drivers/qa survived grounding`);
  return d;
}

async function synthesize(rows: CallDigest[], sessionDay: string): Promise<CallSynthesis | null> {
  const lines = rows.slice(0, 40).map((d) =>
    `${d.symbol} (${d.name}; ${d.sector ?? "sector ?"}; tone ${d.tone}; guidance ${d.guidance.action}${d.guidance.detail ? `: ${d.guidance.detail}` : ""}): ${d.tldr}` +
    (d.kpis.length ? ` | KPIs: ${d.kpis.slice(0, 3).join("; ")}` : "") +
    (d.readThrough.length ? ` | read-through: ${d.readThrough.join("; ")}` : ""));
  const raw = await chatJSON<unknown>(
    SYNTH_SYSTEM,
    `${SYNTH_SCHEMA}\n\nSESSION: ${sessionDay}. ${rows.length} calls digested. TICKERS YOU MAY CITE: ${rows.map((d) => d.symbol).join(", ")}\n\n=== DIGESTS ===\n${lines.join("\n")}`,
    { ...SYNTH_LLM, maxTokens: 1800 },
  );
  return sanitizeSynthesis(raw, rows.map((d) => d.symbol), { sessionDay, n: rows.length, model: SYNTH_MODEL_LABEL, generatedAt: new Date().toISOString() });
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
  const since = lookbackSince(t0, LOOKBACK_DAYS); // sources post hours-to-days after the call: keep asking for a week
  const prior = await readPrior(nowISO);
  const doneSyms = new Set(prior.digests.filter((d) => d.callDate >= since).map((d) => d.symbol)); // digested within the lookback

  // ── candidates: the calendar (snapshot earnings dates) ∪ results 8-Ks (overnight filings) ──
  const cand = new Map<string, Cand>();
  const stockBySym = new Map<string, { name: string; sector: string | null; marketCap: number | null }>();
  for (const uni of US_UNIVERSES) {
    const snap = await loadSnapshot(uni).catch(() => null);
    for (const s of snap?.stocks ?? []) {
      if (!stockBySym.has(s.symbol)) stockBySym.set(s.symbol, { name: s.name, sector: s.sector || null, marketCap: s.marketCap ?? null });
      if (TEST.length && !TEST.includes(s.symbol)) continue;
      const e = s.earningsDate ? Date.parse(s.earningsDate) : NaN;
      if (!Number.isFinite(e) || e < Date.parse(since) - 6 * HOUR || e > t0 + 3 * HOUR) continue;
      if (!cand.has(s.symbol)) cand.set(s.symbol, { symbol: s.symbol, name: s.name, sector: s.sector || null, marketCap: s.marketCap ?? null, why: "calendar" });
    }
  }
  const overnight = await loadOvernightFilings().catch(() => null);
  for (const it of overnight?.items ?? []) {
    if (!it?.ticker || (TEST.length && !TEST.includes(it.ticker))) continue;
    const f = Date.parse(it.filedAt);
    if (!Number.isFinite(f) || f < Date.parse(since)) continue;
    const results = it.surprise !== "na" || (/^8-K/.test(it.form) && /\b(results|quarter|earnings|fiscal)\b/i.test(it.headline || ""));
    if (!results || cand.has(it.ticker)) continue;
    const st = stockBySym.get(it.ticker);
    cand.set(it.ticker, { symbol: it.ticker, name: it.name || st?.name || it.ticker, sector: st?.sector ?? null, marketCap: st?.marketCap ?? null, why: "8-K" });
  }
  for (const s of TEST) if (!cand.has(s)) { const st = stockBySym.get(s); cand.set(s, { symbol: s, name: st?.name || s, sector: st?.sector ?? null, marketCap: st?.marketCap ?? null, why: "test" }); }

  const pending = [...cand.values()].filter((c) => FORCE || !doneSyms.has(c.symbol)).sort((a, b) => (b.marketCap ?? 0) - (a.marketCap ?? 0));
  const investingOk = await investingReachable();
  console.log(`call-digests: session ${w.sessionDay} · reporters since ${since}: ${cand.size} (${doneSyms.size} already digested) → ${pending.length} to look up · sources: Investing.com ${investingOk ? "ok" : "BLOCKED from this IP"} → The Motley Fool · ${MODEL_LABEL}`);

  // ── look up + digest under the wall-clock budget, largest caps first. The lookup IS the fetch (one article
  //    read per reporter), so it lives inside the budget too. ──
  const work = pending.slice(0, CAP);
  let attempted = 0, llmFails = 0, unreadable = 0, notPosted = 0, deferred = pending.length - work.length;
  const sources: Record<string, number> = {};
  const fresh: CallDigest[] = [];
  const budgetMs = BUDGET_MIN * 60_000;
  const lookup = { since, today: w.today };
  await mapPool(work, CONC, async (c) => {
    if (Date.now() - t0 > budgetMs) { deferred++; return; }
    const found = await findRecentTranscript(c.symbol, c.name, lookup).catch(() => null);
    await sleep(150);
    if (!found) { notPosted++; return; }
    const tr: FullTranscript = { ...found.transcript, date: found.date };
    if (tr.text.length < MIN_CHARS) { unreadable++; console.log(`  ${c.symbol}: transcript unreadable (${tr.text.length} chars, ${tr.source})`); return; }
    attempted++;
    const d = await digestOne(c, tr, w.sessionDay).catch(() => null);
    if (!d) { llmFails++; console.log(`  ${c.symbol}: digest failed/empty — will retry next tick`); return; }
    sources[found.source] = (sources[found.source] ?? 0) + 1;
    fresh.push(d);
    console.log(`  ${c.symbol.padEnd(6)} ${d.callDate} · ${tr.source} · ${Math.round(tr.text.length / 1000)}k chars / ${d.chunks} chunk(s) · ${d.tone} · guidance ${d.guidance.action} · ${d.tldr.slice(0, 100)}`);
  });
  console.log(`  ${fresh.length} digested (${Object.entries(sources).map(([k, v]) => `${k} ${v}`).join(", ") || "—"}) · ${notPosted} with no transcript posted yet${investingOk ? "" : " (Investing.com is blocked here — a clean-IP box with CALL_DIGEST_PUBLISH=1 fills these)"} · ${deferred} deferred`);
  if (isMassLlmFailure(attempted, llmFails, deferred)) {
    console.error(`call-digests: ${llmFails}/${attempted} digests failed (${deferred} deferred) — mass LLM failure; keeping last run's file.`);
    process.exit(1);
  }

  const digests = mergeDigests(prior.digests, fresh, KEEP);
  // The cross-call read covers the last three call dates (a weekend spans two sessions; the sources lag a day)
  // and is labelled by the newest call it covers.
  const synthSince = lookbackSince(t0, 3);
  const sessionRows = digests.filter((d) => d.callDate >= synthSince);
  const synthDay = sessionRows[0]?.callDate ?? w.sessionDay;
  let synthesis = prior.synthesis;
  if (sessionRows.length >= 2 && (fresh.length > 0 || !synthesis || synthesis.sessionDay !== synthDay)) {
    const s = await synthesize(sessionRows, synthDay).catch(() => null);
    if (s) synthesis = s;
    else console.warn("  synthesis failed/empty — prior synthesis stands");
  }

  let payload: CallDigestsData = {
    generatedAt: nowISO,
    digests,
    synthesis,
    lastRun: {
      sessionDay: w.sessionDay, candidates: cand.size, withTranscript: attempted + unreadable, digested: fresh.length, deferred, llmFails, budgetMin: BUDGET_MIN, local: LOCAL_CONFIGURED,
      lookbackDays: LOOKBACK_DAYS, notPosted, sources, blocked: investingOk ? [] : ["investing.com"],
    },
  };
  // PUBLISH (a clean-IP box's run): merge with whatever is already in R2 so two runners never clobber each
  // other, ship the merged file, and keep the merged copy locally too.
  if (PUBLISH && r2Configured()) {
    const remote = await getObject(R2_KEY).then((b) => JSON.parse(b.toString("utf8")) as CallDigestsData).catch(() => null);
    if (remote?.digests) payload = mergeCallDigestFiles(payload, remote, KEEP);
    await putObject(R2_KEY, Buffer.from(JSON.stringify(payload)), "application/json");
    console.log(`  published ${payload.digests.length} digests → R2 ${R2_KEY}`);
  } else if (PUBLISH) console.warn("  CALL_DIGEST_PUBLISH=1 but R2 is not configured (LAKE_S3_*) — not published");
  const wr = await writeFeedGuarded("call-digests.json", payload);
  console.log(
    `call-digests: ${wr.written ? "wrote" : "SKIPPED"} ${payload.digests.length} digests (${sessionRows.length} in the synthesis window; +${fresh.length} new, ${deferred} deferred, ${unreadable} unreadable, ${llmFails} failed) · synthesis ${payload.synthesis ? `${payload.synthesis.sessionDay} · ${payload.synthesis.themes.length} themes` : "none"} · ${Math.round((Date.now() - t0) / 60_000)} min${wr.written ? "" : ` — ${wr.reason}`}`,
  );
}

main().catch((e) => { console.error("refresh-call-digests:", String(e?.message || e)); process.exit(1); });
