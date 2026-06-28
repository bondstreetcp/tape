/**
 * Split / reverse-split countermeasure for the price-history pipeline.
 *
 * Background — the "DuPont (DD) +198%" bug:
 * A stock split makes the post-split quote price discontinuous with the stored
 * history series. Two failure modes compound:
 *   1. refresh-quotes re-anchors every timeframe's return by `newPrice/oldPrice`.
 *      A reverse split makes that ratio ≈ the split factor (~2×), so all returns
 *      get multiplied by it → the "+198%" bug, and it persists because each later
 *      intraday tick re-anchors off the now-corrupt (price, returns) pair.
 *   2. Yahoo sometimes serves an UNADJUSTED daily series for a few days after a
 *      split (its back-adjustment lags), so even a fresh `yf.chart` fetch can
 *      carry the discontinuity.
 *
 * This module detects a split-sized discontinuity in a daily close series and,
 * ONLY when the series is genuinely unadjusted across the split, retroactively
 * scales the pre-split closes onto the post-split basis — so both the series file
 * and the returns derived from it stay continuous. It never double-adjusts a
 * series Yahoo already back-adjusted.
 */

export interface SplitEvent {
  date: number; // epoch ms of the split's effective date
  /**
   * Factor that brings PRE-split closes onto the post-split basis
   * = denominator / numerator.
   *   reverse 1-for-2  ⇒ numerator 1, denominator 2 ⇒ priceMult 2   (old $60 → $120)
   *   forward 4-for-1  ⇒ numerator 4, denominator 1 ⇒ priceMult 0.25 (old $400 → $100)
   */
  priceMult: number;
}

/** Coerce a yahoo-style timestamp (seconds, ms, or Date/ISO) to epoch ms. */
function toMs(v: any): number | null {
  if (v == null) return null;
  if (v instanceof Date) return v.getTime();
  if (typeof v === "string") {
    const t = Date.parse(v);
    return Number.isFinite(t) ? t : null;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    // Heuristic: seconds vs ms. Anything below ~10^11 is seconds (≈ year 5138 in s).
    return v < 1e11 ? v * 1000 : v;
  }
  return null;
}

const pnum = (v: any): number | null =>
  typeof v === "number" && Number.isFinite(v) && v > 0 ? v : null;

/**
 * Map a yahoo-finance2 chart `events.splits` object to SplitEvent[].
 * Defensive about shape: `events.splits` may be an object keyed by ts or an array;
 * each entry has { numerator, denominator, date } where date may be seconds, ms,
 * or a Date. Entries we can't interpret are dropped. Result is sorted ascending.
 */
export function splitsFromYahoo(events: any): SplitEvent[] {
  const splits = events?.splits;
  if (!splits) return [];
  const rows: any[] = Array.isArray(splits) ? splits : Object.values(splits);
  const out: SplitEvent[] = [];
  for (const r of rows) {
    if (!r) continue;
    const date = toMs(r.date ?? r.dateRaw ?? r.timestamp);
    const num = pnum(r.numerator ?? r.splitNumerator);
    const den = pnum(r.denominator ?? r.splitDenominator);
    if (date == null || num == null || den == null) continue;
    out.push({ date, priceMult: den / num });
  }
  return out.sort((a, b) => a.date - b.date);
}

const MEANINGFUL = 0.1; // |ln(priceMult)| threshold — ignore trivial/duplicate ratios
const JUMP_TOL = 0.15; // rawJump must be within ±15% of priceMult to count as "unadjusted"

/**
 * Detect and repair an unadjusted split discontinuity in a daily [t, close] series.
 *
 * Processes splits NEWEST→OLDEST. For each split (date D, priceMult M) that is
 * meaningful (|ln M| > 0.1):
 *   - find the last close strictly BEFORE D and the first close ON/AFTER D;
 *   - rawJump = close[firstOnOrAfter] / close[lastBefore];
 *   - if rawJump ≈ M (within ±15%) ⇒ the series is UNADJUSTED across this split
 *     ⇒ multiply every close with date < D by M (on a copy), and record D in `applied`;
 *   - otherwise (rawJump ≈ 1, i.e. Yahoo already adjusted) ⇒ skip — never double-adjust.
 *
 * Pure: the input array is not mutated. Returns a (possibly) adjusted copy plus
 * the list of split dates that were applied.
 */
export function adjustForSplits(
  daily: [number, number][],
  splits: SplitEvent[],
): { daily: [number, number][]; applied: number[] } {
  const applied: number[] = [];
  if (!daily?.length || !splits?.length) {
    return { daily: daily ? daily.map((p) => [p[0], p[1]] as [number, number]) : [], applied };
  }

  // Work on a sorted copy so we never mutate the caller's data.
  const out: [number, number][] = daily
    .map((p) => [p[0], p[1]] as [number, number])
    .sort((a, b) => a[0] - b[0]);

  // Newest split first so earlier (older) adjustments compound correctly onto an
  // already-corrected basis.
  const ordered = [...splits].sort((a, b) => b.date - a.date);

  for (const ev of ordered) {
    const M = ev.priceMult;
    if (!Number.isFinite(M) || M <= 0) continue;
    if (Math.abs(Math.log(M)) <= MEANINGFUL) continue; // trivial — ignore

    const D = ev.date;
    // last close strictly before D, first close on/after D
    let beforeIdx = -1;
    let afterIdx = -1;
    for (let i = 0; i < out.length; i++) {
      if (out[i][0] < D) beforeIdx = i;
      else { afterIdx = i; break; }
    }
    if (beforeIdx < 0 || afterIdx < 0) continue; // split outside the series window

    const cBefore = out[beforeIdx][1];
    const cAfter = out[afterIdx][1];
    if (!(cBefore > 0) || !(cAfter > 0)) continue;

    const rawJump = cAfter / cBefore;
    // Unadjusted across the split iff the observed jump matches the split factor.
    if (Math.abs(rawJump / M - 1) < JUMP_TOL) {
      for (let i = 0; i <= beforeIdx; i++) out[i][1] = out[i][1] * M;
      applied.push(D);
    }
    // else: rawJump ≈ 1 → Yahoo already back-adjusted → skip (no double-adjust).
  }

  applied.sort((a, b) => a - b);
  return { daily: out, applied };
}
