/**
 * Earnings-call digests — every earnings-call transcript from the LAST SESSION, read in full and
 * summarized on the cloud flash tier (the model the overnight SEC-filings digests use; a local server is an
 * opt-in via CALL_DIGEST_LOCAL_* — see scopedLocalEnv), plus a cross-call synthesis for the Daily Desk. Built
 * by scripts/refresh-call-digests.ts on the desk and full ticks; rendered by components/CallDigestsView.tsx
 * (the Daily Desk "Earnings Calls" tab) and fed to the desk brief (scripts/refresh-desk-note.ts) as the
 * "what management actually said" layer.
 *
 * WHY CHUNKS: a full transcript is 50-90k characters (12-22k tokens). Each one is split at paragraph
 * boundaries into ≤ CHUNK_CHARS pieces, each piece is note-taken, and the notes are reduced to ONE digest —
 * a single-chunk call skips the map step. That keeps every read inside a 16k-token window (so an opt-in local
 * server works unchanged) and keeps each flash read short enough to stay grounded.
 *
 * CODE VERIFIES: quotes must be verbatim (grounded against the transcript), every figure in a KPI must
 * appear in the transcript, tone/guidance are closed enums, tickers in the synthesis are whitelisted to the
 * digested set, and a content-empty shell is rejected (lib/llmValidate.narrative).
 *
 * CLIENT-SAFE types + pure helpers. loadCallDigests is the only fs reader (server/scripts only) — the view
 * imports TYPES from here (the overnightFilings precedent).
 */
import path from "path";
import { cachedFile } from "./jsonCache";
import { coerceEnum, groundedQuote, narrative, narrativeList, whitelistTickers } from "./llmValidate";

export type CallTone = "upbeat" | "measured" | "cautious" | "defensive";
export type GuidanceAction = "raised" | "reaffirmed" | "cut" | "initiated" | "withdrawn" | "mixed" | "none";
export type Directness = "direct" | "partial" | "evasive";

export const TONES: readonly CallTone[] = ["upbeat", "measured", "cautious", "defensive"];
export const GUIDANCE_ACTIONS: readonly GuidanceAction[] = ["raised", "reaffirmed", "cut", "initiated", "withdrawn", "mixed", "none"];
export const DIRECTNESS: readonly Directness[] = ["direct", "partial", "evasive"];

/** Characters per model call. ~8.5k tokens of transcript + prompt + a 2.2k-token reply fits the box's
 *  20k-token window with room to spare. */
export const CHUNK_CHARS = 34_000;
/** Beyond this many chunks the tail is dropped (a 5-chunk call is ~170k chars — a marathon; the tail is
 *  the last analysts' questions). */
export const MAX_CHUNKS = 5;

export interface CallQa { analyst: string; question: string; answer: string; directness: Directness }
export interface CallQuote { speaker: string; text: string }

export interface CallDigest {
  symbol: string;
  name: string;
  sector: string | null;
  marketCap: number | null;
  /** YYYY-MM-DD — the transcript's own date (The Motley Fool's path date; usually the call day, sometimes the
   *  morning after for an after-close call). */
  callDate: string;
  title: string;
  url: string;
  source: string;
  tldr: string;
  tone: CallTone;
  guidance: { action: GuidanceAction; detail: string };
  kpis: string[];
  drivers: string[];
  qa: CallQa[];
  readThrough: string[];
  watch: string[];
  quotes: CallQuote[];
  chars: number;
  chunks: number;
  model: string;
  digestedAt: string;
}

export interface CallTheme { heading: string; detail: string; tickers: string[] }
export interface CallSynthesis { sessionDay: string; n: number; tldr: string; themes: CallTheme[]; model: string; generatedAt: string }

export interface CallDigestsData {
  generatedAt: string;
  digests: CallDigest[]; // newest call first
  synthesis: CallSynthesis | null;
  lastRun: {
    sessionDay: string;
    candidates: number;
    withTranscript: number;
    digested: number;
    deferred: number;
    llmFails: number;
    budgetMin: number;
    local: boolean;
    /** Reporter lookback in days (sources lag the call by hours to days). */
    lookbackDays?: number;
    /** Reporters looked up this run with no transcript posted anywhere yet. */
    notPosted?: number;
    /** Digests produced this run, by source ("investing" | "fool"). */
    sources?: Record<string, number>;
    /** Sources that refused this runner's IP (e.g. "investing.com") — a clean-IP box fills the gap. */
    blocked?: string[];
  };
}

const DAY = 86_400_000;

export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/**
 * The session the digests cover: the most recent COMPLETED US trading day before `now` (weekends skipped;
 * holidays aren't special-cased — a holiday just widens the window by a day, harmless). `since` is 00:00 UTC
 * of that day, so the candidate window [since, now] spans yesterday's calls AND today's (a BMO call today
 * whose transcript is already up gets read on the evening tick rather than waiting for tomorrow).
 */
export function sessionWindow(nowMs: number): { since: number; sessionDay: string; today: string } {
  const d = new Date(nowMs);
  d.setUTCHours(0, 0, 0, 0);
  d.setUTCDate(d.getUTCDate() - 1);
  while (d.getUTCDay() === 0 || d.getUTCDay() === 6) d.setUTCDate(d.getUTCDate() - 1);
  return { since: d.getTime(), sessionDay: dayOf(d.getTime()), today: dayOf(nowMs) };
}

/** A transcript belongs to the window when its date is within [sessionDay, today]. */
export function isRecentCallDate(date: string | null | undefined, w: { sessionDay: string; today: string }): boolean {
  return !!date && /^\d{4}-\d{2}-\d{2}$/.test(date) && date >= w.sessionDay && date <= w.today;
}

/** Split one over-long paragraph at sentence ends (never mid-word) into ≤ max pieces. */
function hardSplit(p: string, max: number): string[] {
  const out: string[] = [];
  let rest = p;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(". ", max);
    if (cut < max * 0.5) cut = rest.lastIndexOf(" ", max);
    if (cut < max * 0.5) cut = max;
    out.push(rest.slice(0, cut + 1).trim());
    rest = rest.slice(cut + 1).trim();
  }
  if (rest) out.push(rest);
  return out;
}

/**
 * Chunk a transcript at PARAGRAPH boundaries (a speaker turn is a paragraph in lib/transcripts' output) into
 * pieces of at most `maxChars`. No piece ever starts mid-sentence unless a single paragraph is itself longer
 * than the cap. Pure.
 */
export function chunkTranscript(text: string, maxChars = CHUNK_CHARS): string[] {
  const paras = text.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean).flatMap((p) => (p.length > maxChars ? hardSplit(p, maxChars) : [p]));
  const out: string[] = [];
  let cur = "";
  for (const p of paras) {
    if (cur && cur.length + 2 + p.length > maxChars) { out.push(cur); cur = p; }
    else cur = cur ? `${cur}\n\n${p}` : p;
  }
  if (cur) out.push(cur);
  return out;
}

/** Every numeric token in `s` (commas stripped, so "1,234.5" and "1234.5" agree). */
const numTokens = (s: string): string[] => s.replace(/,/g, "").match(/\d+(?:\.\d+)?/g) || [];

/**
 * A KPI line's figures must come from the transcript: at least ONE of its numeric tokens must appear there
 * ("some", not "every" — "revenue $1.2B vs $1.1B consensus" legitimately carries a non-transcript number).
 * A line with no numbers at all passes (it's a qualitative KPI, judged by the reader).
 */
export function kpiGrounded(line: string, transcript: string): boolean {
  const nums = numTokens(line);
  if (!nums.length) return true;
  const src = transcript.replace(/,/g, "");
  return nums.some((n) => src.includes(n));
}

export interface DigestMeta {
  symbol: string; name: string; sector: string | null; marketCap: number | null;
  callDate: string; title: string; url: string; source: string;
  chars: number; chunks: number; model: string; digestedAt: string;
}

/**
 * Shape + verify the model's digest. Returns null for a shell (no real tldr) or a digest with fewer than two
 * substantive elements — a tldr alone is a headline, not a digest — so the caller retries next tick.
 */
export function sanitizeDigest(raw: unknown, transcript: string, meta: DigestMeta): CallDigest | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
  if (!o) return null;
  const tldr = narrative(o.tldr, 420);
  if (!tldr) return null;
  const g = o.guidance && typeof o.guidance === "object" ? o.guidance : {};
  const guidance = { action: coerceEnum(g.action, GUIDANCE_ACTIONS, "none"), detail: narrative(g.detail, 300) };
  const kpis = narrativeList(o.kpis, 6, 170).filter((k) => kpiGrounded(k, transcript));
  const drivers = narrativeList(o.drivers, 4, 240);
  const qa: CallQa[] = (Array.isArray(o.qa) ? o.qa : [])
    .map((q: any) => ({
      analyst: narrative(q?.analyst, 60),
      question: narrative(q?.question, 240),
      answer: narrative(q?.answer, 320),
      directness: coerceEnum(q?.directness, DIRECTNESS, "partial"),
    }))
    .filter((q: CallQa) => q.question && q.answer)
    .slice(0, 5);
  const readThrough = narrativeList(o.readThrough, 3, 240);
  const watch = narrativeList(o.watch, 3, 170);
  const quotes: CallQuote[] = (Array.isArray(o.quotes) ? o.quotes : [])
    .map((q: any) => ({ speaker: narrative(q?.speaker, 60), text: groundedQuote(q?.text, transcript, 12) ?? "" }))
    .filter((q: CallQuote) => q.text)
    .map((q: CallQuote) => ({ speaker: q.speaker, text: q.text.slice(0, 280) }))
    .slice(0, 3);
  if (kpis.length + drivers.length + qa.length < 2) return null;
  return {
    ...meta,
    tldr,
    tone: coerceEnum(o.tone, TONES, "measured"),
    guidance,
    kpis,
    drivers,
    qa,
    readThrough,
    watch,
    quotes,
  };
}

/** Shape + verify the cross-call synthesis. Tickers are whitelisted to the digested set. */
export function sanitizeSynthesis(
  raw: unknown,
  known: string[],
  meta: { sessionDay: string; n: number; model: string; generatedAt: string },
): CallSynthesis | null {
  const o = raw && typeof raw === "object" ? (raw as Record<string, any>) : null;
  if (!o) return null;
  const tldr = narrative(o.tldr, 480);
  const themes: CallTheme[] = (Array.isArray(o.themes) ? o.themes : [])
    .map((t: any) => ({ heading: narrative(t?.heading, 80), detail: narrative(t?.detail, 520), tickers: whitelistTickers(t?.tickers, known).slice(0, 8) }))
    .filter((t: CallTheme) => t.heading && t.detail)
    .slice(0, 6);
  if (!tldr || !themes.length) return null;
  return { ...meta, tldr, themes };
}

/** Accumulate across runs — one digest per (symbol, call date), fresh wins, newest call first, capped. */
export function mergeDigests(prior: CallDigest[], fresh: CallDigest[], keep: number): CallDigest[] {
  const by = new Map<string, CallDigest>();
  for (const d of prior) if (d?.symbol && d?.callDate) by.set(`${d.symbol}|${d.callDate}`, d);
  for (const d of fresh) if (d?.symbol && d?.callDate) by.set(`${d.symbol}|${d.callDate}`, d);
  const all = [...by.values()];
  all.sort((a, b) => b.callDate.localeCompare(a.callDate) || (b.marketCap ?? 0) - (a.marketCap ?? 0) || a.symbol.localeCompare(b.symbol));
  return keep > 0 ? all.slice(0, keep) : all;
}

/**
 * SCOPED ROUTING: CALL_DIGEST_LOCAL_URL/MODEL(/API_KEY) send ONLY the call-digest job to the local box, by
 * becoming the LLM_LOCAL_* vars lib/llm reads (per call, so assigning them at the top of the script is
 * enough). The rest of the extraction fleet keeps the process-wide LLM_LOCAL_* (unset on the NAS = cloud).
 * Why scoped: the rig's vLLM serves a 32B model with --max-num-seqs 1 — fine for a dozen transcripts a
 * tick, hopeless for overnight-filings' ~4.5M tokens/night inside the step timeouts. Pure; null = unset.
 */
export function scopedLocalEnv(env: Record<string, string | undefined>): Record<string, string> | null {
  const url = (env.CALL_DIGEST_LOCAL_URL || "").trim();
  const model = (env.CALL_DIGEST_LOCAL_MODEL || "").trim();
  if (!url || !model) return null;
  const key = (env.CALL_DIGEST_LOCAL_API_KEY || "").trim();
  return { LLM_LOCAL_BASE_URL: url, LLM_LOCAL_MODEL: model, ...(key ? { LLM_LOCAL_API_KEY: key } : {}) };
}

/**
 * Wall-clock budget by tick: the 08:00 ET desk tick must not push the desk note past the open (12 min); the
 * nightly FULL tick can take the long read (40); anything else (a manual run, the GitHub fallback) 30. An
 * explicit CALL_DIGEST_BUDGET_MIN wins. Pure.
 */
export function budgetMinutes(mode: string | undefined, override: string | undefined): number {
  const o = Number(override);
  if (override && Number.isFinite(o) && o > 0) return o;
  return mode === "desk" ? 12 : mode === "full" ? 40 : 30;
}

/** The calendar day `days` back from now (YYYY-MM-DD) — the reporter lookback / synthesis window floor. */
export function lookbackSince(nowMs: number, days: number): string {
  return dayOf(nowMs - days * DAY);
}

/**
 * Union of two copies of the feed — a clean-IP box's PUBLISHED file and a runner's own — so two writers never
 * clobber each other: digests keyed by (symbol, call date) with the more recently digested row winning, the
 * newer synthesis, the newer run's stats and stamp. Pure — used by the publish step and by data-from-r2.
 */
export function mergeCallDigestFiles(a: CallDigestsData, b: CallDigestsData, keep = 160): CallDigestsData {
  const newer = Date.parse(b.generatedAt) > Date.parse(a.generatedAt) ? b : a;
  const older = newer === a ? b : a;
  const by = new Map<string, CallDigest>();
  for (const d of [...(older.digests ?? []), ...(newer.digests ?? [])]) {
    if (!d?.symbol || !d?.callDate) continue;
    const k = `${d.symbol}|${d.callDate}`;
    const cur = by.get(k);
    if (!cur || Date.parse(d.digestedAt || "") >= Date.parse(cur.digestedAt || "")) by.set(k, d);
  }
  const synths = [a.synthesis, b.synthesis].filter((s): s is CallSynthesis => !!s).sort((x, y) => Date.parse(y.generatedAt) - Date.parse(x.generatedAt));
  return { generatedAt: newer.generatedAt, digests: mergeDigests([], [...by.values()], keep), synthesis: synths[0] ?? null, lastRun: newer.lastRun };
}

/** The digests that belong to the file's last session (call date on/after the run's session day). */
export function sessionDigests(data: Pick<CallDigestsData, "digests" | "lastRun">): CallDigest[] {
  const floor = data.lastRun?.sessionDay ?? "";
  return data.digests.filter((d) => d.callDate >= floor);
}

// mtime-keyed (lib/jsonCache) — re-reads after an in-place data/ hydrate.
export function loadCallDigests(): Promise<CallDigestsData | null> {
  return cachedFile(path.join(process.cwd(), "data", "call-digests.json"), (s) => JSON.parse(s) as CallDigestsData);
}
