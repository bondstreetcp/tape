/**
 * Preview-log: the ACCURACY track record for the desk's predicted prints. Every night the logger
 * (scripts/refresh-earnings-preview-log.ts) records the model's OWN forecast for names about to report
 * — predicted EPS, beat/miss call, reaction direction, and its checkable qualitative calls — then,
 * once the company reports, CODE grades the numeric calls against the actuals. "If it turns out to be
 * accurate, that has value" — this is the instrument that measures it.
 *
 * CLIENT-SAFE: types + pure grading math ONLY (no fs, no network, no LLM). The generator lives in
 * lib/earningsPreview.ts (server). Qualitative calls are RECORDED but not auto-graded — an LLM grading
 * its own prose would break "code verifies, models propose"; they're displayed for human judgment.
 */

export interface PreviewCall { claim: string; rationale: string }

export type PreviewStatus = "awaiting_print" | "settled";

export interface PreviewRec {
  id: string; // `${symbol}-${earningsDate YYYY-MM-DD}` — one prediction per name per print
  symbol: string;
  name: string;
  sector?: string;
  loggedAt: string; // ISO — when the forecast was recorded (must PREDATE the print; forward-only)
  earningsDate: string; // ISO
  // the bar at log time (consensus can drift after logging — grade against what the desk saw)
  consEps: number | null;
  consRevB: number | null;
  // the forecast
  predEps: number | null;
  predRevB: number | null;
  vsConsensus: "beat" | "miss" | "inline";
  reactionDir: "up" | "down";
  confidence: "high" | "medium" | "low";
  calls: PreviewCall[];

  // ── settlement (code-graded once the print lands) ──
  status: PreviewStatus;
  actualEps?: number | null;
  actualSurprise?: number | null; // EPS surprise vs consensus AT PRINT TIME (decimal, from the reaction feed)
  actualMovePct?: number | null; // signed 1-day reaction, %
  epsHit?: boolean | null; // predicted EPS within the accuracy band of the actual
  epsErrPct?: number | null; // |pred − actual| / |actual|, %
  dirHit?: boolean | null; // the beat/miss/inline call matched what happened vs consensus
  reactionHit?: boolean | null; // predicted reaction direction matched the realized move (null = flat print, ungradable)
  settledAt?: string | null;
}

export interface PreviewLogData {
  generatedAt: string;
  recs: PreviewRec[];
}

// ── grading bands (documented so "accurate" means one fixed thing) ──────────────────────────────
export const EPS_HIT_ABS = 0.02; // predicted EPS within ±2c of actual…
export const EPS_HIT_REL = 0.05; // …or within ±5% of |actual| — whichever is larger (penny-scale vs $10-EPS names)
export const INLINE_BAND = 0.005; // |surprise| ≤ 0.5% counts as printing "inline" with consensus
export const FLAT_MOVE_PCT = 0.5; // |1-day move| below this is a flat print — no honest reaction grade

/** Was the predicted EPS accurate? Band = max($0.02, 5% of |actual|). */
export function gradeEps(predEps: number | null, actualEps: number | null): { hit: boolean; errPct: number | null } | null {
  if (predEps == null || actualEps == null) return null;
  const err = Math.abs(predEps - actualEps);
  const band = Math.max(EPS_HIT_ABS, EPS_HIT_REL * Math.abs(actualEps));
  return { hit: err <= band, errPct: actualEps !== 0 ? (err / Math.abs(actualEps)) * 100 : null };
}

/** What the print actually did vs consensus, from the reaction feed's surprise (decimal). */
export function actualDirection(surprise: number | null): "beat" | "miss" | "inline" | null {
  if (surprise == null) return null;
  return Math.abs(surprise) <= INLINE_BAND ? "inline" : surprise > 0 ? "beat" : "miss";
}

/** Did the predicted 1-day direction match? null on a flat print — a coin-flip shouldn't score. */
export function gradeReaction(dir: "up" | "down", movePct: number | null): boolean | null {
  if (movePct == null || Math.abs(movePct) < FLAT_MOVE_PCT) return null;
  return dir === "up" ? movePct > 0 : movePct < 0;
}

export interface PreviewStats {
  settledN: number;
  preprintN: number; // logged, awaiting the report
  epsGraded: number;
  epsHits: number;
  avgAbsEpsErrPct: number | null; // mean |pred − actual| / |actual| across graded
  dirGraded: number;
  dirHits: number;
  reactionGraded: number;
  reactionHits: number;
  byConfidence: Record<"high" | "medium" | "low", { n: number; dirHits: number; dirGraded: number }>;
}

/** Aggregate the accuracy record. Every number here is code-computed from the graded fields. */
export function summarizePreviews(recs: PreviewRec[]): PreviewStats {
  const settled = recs.filter((r) => r.status === "settled");
  const epsG = settled.filter((r) => r.epsHit != null);
  const errs = settled.map((r) => r.epsErrPct).filter((x): x is number => x != null);
  const dirG = settled.filter((r) => r.dirHit != null);
  const rxG = settled.filter((r) => r.reactionHit != null);
  const byConf = (c: "high" | "medium" | "low") => {
    const g = settled.filter((r) => r.confidence === c && r.dirHit != null);
    return { n: settled.filter((r) => r.confidence === c).length, dirHits: g.filter((r) => r.dirHit).length, dirGraded: g.length };
  };
  return {
    settledN: settled.length,
    preprintN: recs.filter((r) => r.status === "awaiting_print").length,
    epsGraded: epsG.length,
    epsHits: epsG.filter((r) => r.epsHit).length,
    avgAbsEpsErrPct: errs.length ? errs.reduce((a, b) => a + b, 0) / errs.length : null,
    dirGraded: dirG.length,
    dirHits: dirG.filter((r) => r.dirHit).length,
    reactionGraded: rxG.length,
    reactionHits: rxG.filter((r) => r.reactionHit).length,
    byConfidence: { high: byConf("high"), medium: byConf("medium"), low: byConf("low") },
  };
}
