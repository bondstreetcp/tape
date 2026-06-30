/**
 * Management GUIDANCE (forward outlook) extracted from earnings releases. Like comps, guidance is a
 * company-DISCLOSED forward statement with no API/XBRL tag → LLM-extract from the 8-K Ex-99.1 text
 * (scripts/refresh-guidance.ts → data/guidance.json). Surfaced on the Earnings-prep card: the standing
 * guide (revenue/EPS ranges) + raise/reaffirm/cut, and the guide midpoint vs the analyst consensus.
 *
 * CLIENT-SAFE: types + the vs-consensus pure helper only (no fs/llm/edgar). Imported by EarningsPrep.
 */
export type GuidanceAction = "raise" | "reaffirm" | "cut" | "initiate" | "mixed" | "none";

export interface GuidancePeriod {
  period: string; // what the guide covers, e.g. "FY2026" / "Q3 FY26"
  metricLabel?: string; // the issuer's own framing if useful
  revLowM: number | null; // revenue guide range, MILLIONS USD
  revHighM: number | null;
  epsLow: number | null; // EPS guide range, $/share
  epsHigh: number | null;
  action: GuidanceAction; // vs the company's PRIOR outlook
  quote?: string | null;
  confidence?: "high" | "medium" | "low";
}

// One past earnings filing's data point, for the "beats its own guide" track record. Each filing reports
// the just-completed quarter's ACTUAL EPS and (often) a guide for the NEXT quarter's EPS — so the quarter
// reported in filing[i] was guided in filing[i+1] (the prior filing). Consecutive filings = consecutive
// quarters, so the alignment needs no fuzzy period-matching.
export interface GuidanceHistoryPoint {
  date: string; // the 8-K date
  reportedEps: number | null; // ACTUAL EPS the company just reported for the completed quarter
  nextQEpsLow: number | null; // the guide given IN THIS filing for the NEXT quarter's EPS
  nextQEpsHigh: number | null;
}

export interface GuidanceTicker {
  lastAccession?: string; // newest earnings 8-K seen → the incremental gate
  updated: string; // the 8-K date the guide is from
  source: { form: string; url: string; date: string };
  guides: GuidancePeriod[]; // newest first — usually the FY guide (+ a next-quarter guide)
  history?: GuidanceHistoryPoint[]; // newest first — actual-vs-next-quarter-guide chain
}

/** "Beats its own guide" rate: align each quarter's actual EPS to the next-quarter guide given one filing
 *  earlier (consecutive ~quarterly filings). Returns beats/total + avg actual-vs-guide. null if < 2 pairs. */
export function beatGuide(history: GuidanceHistoryPoint[] | undefined): { beats: number; total: number; avgVsGuide: number | null } | null {
  if (!history || history.length < 2) return null;
  let beats = 0, total = 0, sumPct = 0;
  for (let i = 0; i < history.length - 1; i++) {
    const gap = (Date.parse(history[i].date) - Date.parse(history[i + 1].date)) / 86_400_000;
    if (!(gap >= 60 && gap <= 130)) continue; // require consecutive quarters (~3 months apart)
    const actual = history[i].reportedEps;
    const lo = history[i + 1].nextQEpsLow, hi = history[i + 1].nextQEpsHigh;
    const gMid = lo != null && hi != null ? (lo + hi) / 2 : lo ?? hi;
    if (actual == null || gMid == null || gMid === 0) continue;
    total++;
    if (actual >= gMid) beats++;
    sumPct += actual / gMid - 1;
  }
  return total >= 2 ? { beats, total, avgVsGuide: sumPct / total } : null;
}

export interface GuidanceData {
  generatedAt: string;
  byTicker: Record<string, GuidanceTicker>;
}

const mid = (lo: number | null, hi: number | null): number | null =>
  lo != null && hi != null ? (lo + hi) / 2 : lo ?? hi ?? null;

/** Guide midpoint vs the analyst consensus (a fraction, e.g. +0.03 = guide 3% above the Street).
 *  `consensusRevM` is in the same MILLIONS unit; `consensusEps` in $. Returns null if not comparable. */
export function guideVsConsensus(
  g: GuidancePeriod,
  consensusRevM: number | null,
  consensusEps: number | null,
): { revPct: number | null; epsPct: number | null } {
  const gRev = mid(g.revLowM, g.revHighM);
  const gEps = mid(g.epsLow, g.epsHigh);
  return {
    revPct: gRev != null && consensusRevM ? gRev / consensusRevM - 1 : null,
    epsPct: gEps != null && consensusEps ? gEps / consensusEps - 1 : null,
  };
}

export const guideMidRevM = (g: GuidancePeriod) => mid(g.revLowM, g.revHighM);
export const guideMidEps = (g: GuidancePeriod) => mid(g.epsLow, g.epsHigh);
