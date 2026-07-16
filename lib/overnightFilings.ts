/**
 * Overnight Filings (SuperAnalyst) — AI desk notes on new material SEC filings,
 * each summarized vs the PRIOR comparable filing of the same type. The heavy
 * lifting (EDGAR detection + LLM extraction) happens offline in
 * scripts/refresh-overnight-filings.ts → data/overnight-filings.json; this module
 * owns the types + the cached loader (mirrors lib/congress.ts).
 *
 * AI-generated from the supplied filing text — spot-check claims against the source.
 */
import { promises as fsp } from "fs";
import path from "path";

export type Sentiment = "bullish" | "neutral" | "bearish";
export type Surprise = "beat" | "inline" | "miss" | "na";
/** How market-moving the model judges the filing to be (drives the red/green flag + Movers filter). */
export type Impact = "high" | "medium" | "low";

/** The model's per-filing digest (see the SYSTEM/SCHEMA in the refresh script). */
export interface OvernightDigest {
  headline: string;
  whatChanged: string[];
  decisionTakeaway: string;
  sentiment: Sentiment;
  surprise: Surprise;
  impact: Impact;
  keyMetrics: Record<string, unknown>;
}

export interface OvernightItem extends OvernightDigest {
  ticker: string;
  name: string;
  form: string; // 8-K, 10-Q, 10-K (or an /A amendment)
  filedAt: string; // EDGAR acceptanceDateTime (ET)
  riskFactorsAdded: number | null; // 10-K/Q only — machine-diffed risk-factor delta
  riskFactorsRemoved: number | null;
  accession: string;
  url: string; // EDGAR filing-index page for this accession
}

export interface OvernightData {
  generatedAt: string;
  windowHours: number;
  since: string; // ISO — start of the detection window
  count: number;
  items: OvernightItem[]; // newest filing first
}

/**
 * PURE carry-forward merge — the core of the refresh script's "degrade to STALE, never EMPTY" guard.
 *
 * A budget-truncated or partially-failed run produces only SOME of the window's digests; publishing
 * just those would shrink the feed. So merge in prior digests that are still IN-WINDOW and that this
 * run did NOT definitively resolve. `resolvedAccessions` = accessions this run settled for certain
 * (produced a digest OR NONE-gated as immaterial) — those must NOT be carried (a NONE-gate is a real
 * drop). Everything else the run didn't reach (unscanned, budget-deferred, unreadable, LLM-failed)
 * keeps its prior digest. Fresh digests win on a duplicate accession; result is newest-first, capped.
 */
export function mergeCarryForward(
  fresh: OvernightItem[],
  resolvedAccessions: Set<string>,
  prior: OvernightItem[],
  windowStartMs: number,
  maxItems: number,
): { items: OvernightItem[]; carried: number } {
  const out = [...fresh];
  const have = new Set(fresh.map((it) => it.accession));
  let carried = 0;
  for (const it of prior) {
    if (!it?.accession || have.has(it.accession) || resolvedAccessions.has(it.accession)) continue;
    const f = Date.parse(it.filedAt);
    if (!Number.isFinite(f) || f < windowStartMs) continue; // aged out of the current window
    out.push(it);
    have.add(it.accession); // guard against duplicate accessions within `prior` itself
    carried++;
  }
  out.sort((a, b) => Date.parse(b.filedAt) - Date.parse(a.filedAt)); // newest-first
  return { items: out.length > maxItems ? out.slice(0, maxItems) : out, carried };
}

/**
 * Should this run KEEP last night's file (exit non-zero) instead of publishing? A mass-LLM-failure
 * backstop: a fresh generatedAt over mostly-carried data would MASK the outage from the file-age-
 * keyed freshness monitor. A high failure RATE among ATTEMPTED digests is the signal.
 *
 * ⚠ The `>= 5` floor exists to avoid crying outage on a tiny QUIET-night sample (1 blip in 2). But a
 * budget-TRUNCATED run (deferred > 0) also has a small `attempted` — for a completely different
 * reason — so the floor is BYPASSED there: a hanging LLM that fails the few it reaches before the
 * clock runs out is a real outage, not a quiet night. Without this, a slow-LLM night on the NAS
 * writes fresh and hides exactly the failure the pre-budget code surfaced by being killed. Pure.
 */
export function isMassLlmFailure(attempted: number, llmFails: number, deferred: number): boolean {
  if (attempted <= 0 || llmFails <= attempted * 0.3) return false;
  return attempted >= 5 || deferred > 0;
}

let _cache: Promise<OvernightData | null> | null = null;

export function loadOvernightFilings(): Promise<OvernightData | null> {
  if (!_cache)
    _cache = fsp
      .readFile(path.join(process.cwd(), "data", "overnight-filings.json"), "utf8")
      .then((s) => JSON.parse(s) as OvernightData)
      .catch(() => null);
  return _cache;
}
