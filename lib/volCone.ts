/**
 * Realized-volatility cone (Burghardt & Lane). For a name's daily closes we compute annualized realized
 * vol over several horizons (10 / 21 / 63 / 126 / 252 trading days) and, for EACH horizon, the historical
 * distribution of that horizon's rolling realized vol — the "cone" (min / p25 / median / p75 / max). Where
 * CURRENT realized vol sits inside its own cone is the screener signal: bottom of the cone = the name is
 * historically quiet (coiled — cheap gamma / breakout risk); top = blown out (mean-reversion / sell premium).
 *
 * Pure + fs-free (unit-tested), driven only by the stored price series — so it works for EVERY universe
 * (US + international), not just the US options names. The annualized-vol convention matches
 * lib/putwrite.realizedVol (de-meaned sample stdev of log returns × √252) so "realized vol" is one thing
 * app-wide; the rolling distribution uses prefix sums so a ~6-year series scores in O(n) per horizon.
 * Doctrine: code computes the stat, no LLM.
 */
import { bucketByDay, type Daily } from "./pairs";
export type { Daily } from "./pairs"; // re-exported so the refresh script + tests import it from here

export const CONE_HORIZONS = [10, 21, 63, 126, 252] as const; // ~2w, 1m, 1q, 6m, 1y
const ANN = 252;
const MIN_WINDOWS = 20; // fewest rolling windows to emit a horizon's cone
// The stored series are NOT split-adjusted, so a split day is a huge phantom "return" (a 2:1 split ≈ −69%,
// a 1:2 reverse ≈ +69%) that would pump realized vol to 250%+. Any |daily log return| beyond this is
// almost certainly a split or a bad tick, not a real move (even the worst real single-day crashes are ~−40%),
// so we drop it before computing vol. Cheap, robust split/bad-tick filter for the whole cross-universe roster.
const RET_CAP = 0.5;

export interface ConeBand {
  h: number; // horizon (trading days)
  cur: number | null; // current annualized realized vol over the last h days (fraction)
  pct: number | null; // percentile (0-100) of cur within this horizon's own historical distribution
  min: number;
  p25: number;
  med: number;
  p75: number;
  max: number;
  n: number; // rolling windows in the distribution
}

export interface VolConeRow {
  symbol: string;
  name: string;
  sector: string;
  bands: ConeBand[];
  cur20: number | null; // headline: current 21-day RV
  pct20: number | null; // its percentile in own history (LOW = quiet/coiled, HIGH = blown out)
  cur252: number | null; // 1-year RV (the long-run anchor)
  termSlope: number | null; // cur(21) / cur(126) − 1: >0 vol expanding (recent shock), <0 contracting
  hist: number; // # of daily returns available
}

/** The COMPACT row stored in data/vol-cone.json + read by the board (the full `bands` array is a ~3MB-at-
 *  4000-names luxury the screener doesn't need; it keeps the headline 21d + 63d + the 21d cone bounds). */
export interface VolConeFeedRow {
  symbol: string;
  name: string;
  sector: string;
  cur20: number | null; // current 21d realized vol (fraction)
  pct20: number | null; // its percentile in own history (LOW = coiled, HIGH = blown out)
  min20: number | null; // 21d cone bounds → the "position in cone" bar
  med20: number | null;
  max20: number | null;
  cur63: number | null; // 1-quarter RV
  pct63: number | null;
  cur252: number | null; // 1-year anchor
  termSlope: number | null; // cur(21)/cur(126) − 1: >0 expanding, <0 contracting
  hist: number;
}

/** Project the full analytic to the compact feed row. */
export function toFeedRow(r: VolConeRow): VolConeFeedRow {
  const b21 = r.bands.find((b) => b.h === 21);
  const b63 = r.bands.find((b) => b.h === 63);
  return {
    symbol: r.symbol, name: r.name, sector: r.sector,
    cur20: r.cur20, pct20: r.pct20,
    min20: b21?.min ?? null, med20: b21?.med ?? null, max20: b21?.max ?? null,
    cur63: b63?.cur ?? null, pct63: b63?.pct ?? null,
    cur252: r.cur252, termSlope: r.termSlope, hist: r.hist,
  };
}

export interface VolConeData {
  generatedAt: string;
  horizons: number[];
  rows: VolConeFeedRow[];
}

/** Daily close-to-close log returns from a stored series (day-bucketed → one close per calendar day). */
export function logReturnsOf(daily: Daily): number[] {
  const closes = bucketByDay(daily).map(([, p]) => p).filter((p) => p > 0);
  const r: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    if (!(closes[i] > 0 && closes[i - 1] > 0)) continue;
    const lr = Math.log(closes[i] / closes[i - 1]);
    if (Math.abs(lr) <= RET_CAP) r.push(lr); // drop split / bad-tick days
  }
  return r;
}

function quantile(sortedAsc: number[], q: number): number {
  const n = sortedAsc.length;
  if (n === 0) return NaN;
  if (n === 1) return sortedAsc[0];
  const pos = q * (n - 1);
  const lo = Math.floor(pos), hi = Math.ceil(pos);
  return lo === hi ? sortedAsc[lo] : sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * (pos - lo);
}

/**
 * The full cone for one horizon: the rolling series of annualized realized vol over every h-return window,
 * summarized as min/quartiles/max, plus where the LAST (current) window sits as a percentile. Prefix sums
 * make each window O(1). Returns null if there aren't at least MIN_WINDOWS windows.
 */
function coneBand(rets: number[], p1: number[], p2: number[], h: number): ConeBand | null {
  const n = rets.length;
  if (n < h + MIN_WINDOWS) return null; // too little history for a meaningful cone at this horizon
  const rolling: number[] = [];
  for (let i = 0; i + h <= n; i++) {
    const sr = p1[i + h] - p1[i];
    const sr2 = p2[i + h] - p2[i];
    const varc = (sr2 - (sr * sr) / h) / (h - 1);
    rolling.push(Math.sqrt(Math.max(0, varc) * ANN));
  }
  const cur = rolling[rolling.length - 1];
  const sorted = [...rolling].sort((a, b) => a - b);
  const pct = (rolling.filter((v) => v <= cur).length / rolling.length) * 100;
  return {
    h, cur, pct,
    min: sorted[0], p25: quantile(sorted, 0.25), med: quantile(sorted, 0.5), p75: quantile(sorted, 0.75), max: sorted[sorted.length - 1],
    n: rolling.length,
  };
}

/** Build a name's vol-cone row from its stored series. null if too little history. */
export function buildVolCone(symbol: string, name: string, sector: string, daily: Daily, horizons: readonly number[] = CONE_HORIZONS): VolConeRow | null {
  const rets = logReturnsOf(daily);
  if (rets.length < CONE_HORIZONS[1] + MIN_WINDOWS) return null; // need at least the 21d cone

  const p1 = new Array(rets.length + 1).fill(0);
  const p2 = new Array(rets.length + 1).fill(0);
  for (let i = 0; i < rets.length; i++) { p1[i + 1] = p1[i] + rets[i]; p2[i + 1] = p2[i] + rets[i] * rets[i]; }

  const bands = horizons.map((h) => coneBand(rets, p1, p2, h)).filter((b): b is ConeBand => b != null);
  if (!bands.length) return null;
  const at = (h: number) => bands.find((b) => b.h === h) ?? null;
  const b21 = at(21), b126 = at(126), b252 = at(252);
  const termSlope = b21?.cur != null && b126?.cur != null && b126.cur > 0 ? b21.cur / b126.cur - 1 : null;
  return {
    symbol, name, sector, bands,
    cur20: b21?.cur ?? null, pct20: b21?.pct ?? null, cur252: b252?.cur ?? null, termSlope,
    hist: rets.length,
  };
}
