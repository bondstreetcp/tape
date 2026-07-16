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

// ── The split ledger ─────────────────────────────────────────────────────────────────────────────
// build-data already fetches `events: "div,split"` for every US name nightly (it needs them for the
// countermeasure above) and then throws the split list away. Persisting it costs ZERO extra fetches
// and gives anything downstream an authoritative "what split, and when" record — which the forward-
// accumulating signal log needs to keep its stored entry prices on today's basis.
//
// Coverage is provable rather than hopeful: every symbol build-data writes a snapshot for is a symbol
// it fetched chart events for. Anything reading a US snapshot is therefore covered by construction.
//
// ⚠ "Splits" here means what Yahoo calls a split, which is WIDER than the name suggests: it also
// encodes SPINOFFS as an odd-ratio split (the live ledger carries FDX ×0.8058 for the FedEx Freight
// separation alongside NFLX ×0.1 for a clean 10-for-1). That is a feature, not contamination —
// consumers re-base stored prices to match the snapshot/series price, and build-data adjusts those
// for spinoffs too, so the two stay on ONE basis. Ratios within ~10% of 1.0 are below every
// consumer's MEANINGFUL floor and get ignored downstream; they're kept here rather than filtered so
// the ledger stays a faithful record of what the vendor reported.

export interface SplitLedgerFile {
  generatedAt: string;
  /** symbol → splits within the retention window, ascending by date. */
  splits: Record<string, SplitEvent[]>;
}

/** How much history the ledger keeps. Comfortably longer than the signal log's 3-month horizon. */
export const LEDGER_WINDOW_DAYS = 400;

const DAY_MS = 86_400_000;

/**
 * Floor a split's timestamp to UTC midnight of its effective date.
 *
 * ⚠ This is load-bearing, not cosmetic. Consumers key their "already applied" bookkeeping off
 * `date`, so the value MUST be identical every night — a vendor timestamp that drifts by hours
 * between runs would read as a NEW split and get applied a second time. Flooring makes the key a
 * function of the calendar day, which is the only part of it that's actually stable.
 */
const utcDay = (ms: number) => Math.floor(ms / DAY_MS) * DAY_MS;

/**
 * Fold tonight's observations into the ledger.
 *
 * MERGE, never replace: `observed` only carries the symbols whose chart fetch SUCCEEDED, so a name
 * Yahoo dropped tonight keeps yesterday's splits instead of silently losing them. That makes this
 * feed structurally incapable of degrading to empty — the same "stale, never destroyed" rule
 * lib/feedGuard enforces for the counted feeds, achieved here by construction instead of a guard.
 *
 * Pure. First observation of a given (symbol, day) wins; entries older than the window are dropped.
 */
export function mergeSplitLedger(
  prev: SplitLedgerFile | null,
  observed: Map<string, SplitEvent[]>,
  nowMs: number,
  windowDays = LEDGER_WINDOW_DAYS,
): SplitLedgerFile {
  const cutoff = utcDay(nowMs) - windowDays * DAY_MS;
  const out: Record<string, SplitEvent[]> = {};

  const symbols = new Set([...Object.keys(prev?.splits ?? {}), ...observed.keys()]);
  for (const sym of symbols) {
    const byDay = new Map<number, SplitEvent>();
    for (const s of [...(prev?.splits?.[sym] ?? []), ...(observed.get(sym) ?? [])]) {
      if (!s || !Number.isFinite(s.date) || !Number.isFinite(s.priceMult) || s.priceMult <= 0) continue;
      const date = utcDay(s.date);
      if (date < cutoff) continue;
      if (!byDay.has(date)) byDay.set(date, { date, priceMult: s.priceMult });
    }
    if (byDay.size) out[sym] = [...byDay.values()].sort((a, b) => a.date - b.date);
  }
  return { generatedAt: new Date(nowMs).toISOString(), splits: out };
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

/* ───────────────────────────── Spinoff countermeasure ─────────────────────────────
 *
 * A spinoff is economically different from a split: the parent's price genuinely
 * steps DOWN on the ex-date by the value of the spun-off business. Shareholders are
 * made whole (they now hold parent + spinco), so the parent's *total return* is ~flat
 * across the ex-date — but a price-only series shows a crater that craters the parent's
 * 3m/1y returns.
 *
 * What Yahoo actually does (investigated empirically against GE/GEV, GE/GEHC, MMM/SOLV,
 * JNJ/KVUE — see git history / probe):
 *
 *   1. MOST large spinoffs are encoded in `events.splits` as a sub-integer RATIO split
 *      (e.g. GE→GEV "1253:1000", MMM→SOLV "1196:1000"). Yahoo bakes this into BOTH
 *      `close` and `adjclose`, so the steady-state daily `close` is ALREADY continuous
 *      (no crater) and `adjForSplits` is the right tool: it back-adjusts only when Yahoo
 *      served the series UNADJUSTED (its back-adjustment lags a few days post ex-date),
 *      exactly the split lag mode. `isSpinoffRatio` classifies these for logging.
 *
 *   2. A few spinoffs are encoded only as a small `events.dividends` entry of normal,
 *      regular-dividend size (e.g. JNJ→KVUE booked $1.19, NOT Kenvue's ~$45 value). These
 *      leave NO detectable signal — the back-adjust factor f=adjclose/close steps by
 *      <1%, smaller than ordinary dividends — and, crucially, Yahoo's `close` for them is
 *      already continuous, so there is nothing to repair. We deliberately do NOT chase
 *      these: any threshold low enough to catch them fires on regular dividends.
 *
 * `adjustForSpinoffs` below is the belt-and-suspenders detector for the (currently not
 * observed, but possible) case where Yahoo serves a series whose `close` is UNADJUSTED
 * across a spinoff while `adjclose` IS adjusted — i.e. the back-adjust factor f steps by
 * a spinoff-sized amount at a date that is NOT a split. That step is the reliable signal;
 * the threshold is set well above the observed regular-/special-dividend ceiling (~1.7%).
 */

/** A ratio-split whose factor isn't a clean integer ratio (e.g. 1253:1000) is, in
 *  practice, a spinoff Yahoo booked as a split rather than a true forward/reverse split.
 *  Used only for classification/logging — adjustment is handled by adjustForSplits. */
export function isSpinoffRatio(ev: SplitEvent): boolean {
  const M = ev.priceMult;
  if (!Number.isFinite(M) || M <= 0) return false;
  // A spinoff steps the price DOWN modestly (M in roughly (0.6, 0.98)); a true forward
  // split has M ≤ ~0.5 (2:1, 4:1…) and a reverse split has M ≥ ~1.5. Spinoffs land in the
  // gap between "no real change" and "a genuine integer-ish split".
  const ratio = 1 / M; // shares-per-share-ish
  const nearInteger = Math.abs(ratio - Math.round(ratio)) < 0.05 && Math.round(ratio) >= 2;
  if (nearInteger) return false; // clean forward split like 2:1, 3:1, 4:1
  if (M >= 1.05) return false; // reverse split (price up)
  return M > 0.5 && M < 0.985; // modest down-step that isn't a clean split
}

/** Minimum step in the back-adjust factor f=adjclose/close to treat as a spinoff/special
 *  distribution rather than a dividend. Tuned from Step-1 data: the largest factor step a
 *  regular/special DIVIDEND produced across the test names was ~1.7%; a real spinoff is
 *  10%+. 3% sits safely between — conservative, never catches dividends. */
const SPINOFF_FACTOR_STEP = 0.03;
/** Days of tolerance when matching a factor-step date to a known split date. */
const SPLIT_MATCH_DAYS = 4;

/**
 * Spinoff continuity repair via the back-adjust factor f = adjclose / close.
 *
 * For a series where Yahoo left `close` UNADJUSTED across a spinoff but adjusted
 * `adjclose`, f steps DOWN (going backward in time it steps UP) at the ex-date by the
 * spinoff factor. We detect a day-over-day step in f exceeding SPINOFF_FACTOR_STEP that is
 *   - NOT at/near a known split date (those are handled by adjustForSplits), and
 *   - large enough to be a spinoff, not a dividend,
 * then back-adjust every close strictly BEFORE the ex-date by that factor so the price
 * series is continuous across the spinoff (total-return basis), matching what `adjclose`
 * already implies.
 *
 * `adjclose` must be the per-day adjusted-close aligned to `daily` (same dates). Rows
 * missing a usable adjclose are skipped for detection. Pure: input is not mutated.
 *
 * No-op (and that is the common case today) when `close` is already spinoff-adjusted — f
 * is then flat across the ex-date, so no step is seen.
 */
export function adjustForSpinoffs(
  daily: [number, number][],
  adjclose: [number, number][],
  splitDates: number[] = [],
): { daily: [number, number][]; applied: number[] } {
  const applied: number[] = [];
  const copy = (arr: [number, number][]) => (arr ? arr.map((p) => [p[0], p[1]] as [number, number]) : []);
  if (!daily?.length || !adjclose?.length) return { daily: copy(daily), applied };

  const out = copy(daily).sort((a, b) => a[0] - b[0]);

  // Build f = adjclose/close keyed by date (only where both are positive).
  const adjByDate = new Map<number, number>();
  for (const [t, a] of adjclose) if (a > 0) adjByDate.set(t, a);
  const f: { t: number; v: number; idx: number }[] = [];
  for (let i = 0; i < out.length; i++) {
    const c = out[i][1];
    const a = adjByDate.get(out[i][0]);
    if (c > 0 && a != null && a > 0) f.push({ t: out[i][0], v: a / c, idx: i });
  }
  if (f.length < 2) return { daily: out, applied };

  const nearSplit = (t: number) =>
    splitDates.some((d) => Math.abs(t - d) <= SPLIT_MATCH_DAYS * 86_400_000);

  // Scan NEWEST→OLDEST so earlier back-adjustments compound onto a corrected basis.
  //
  // At a spinoff ex-date the back-adjust factor f = adjclose/close is DISCONTINUOUS:
  // because `close` is unadjusted but `adjclose` carries the spinoff, f differs on the two
  // sides of ex. We trigger on a step in f whose MAGNITUDE (either direction) exceeds the
  // spinoff threshold. The multiplier that brings pre-ex closes onto the ex (post-step)
  // basis is f[before]/f[after]: corrected close_pre = close_pre · (f_before/f_after) makes
  // close_pre·(f_before/f_after) continuous with the post-ex close, matching what adjclose
  // implies. (When `close` is already spinoff-adjusted, f is flat → no step → no-op.)
  for (let k = f.length - 1; k >= 1; k--) {
    const cur = f[k]; // the ex-date row (first on/after the step)
    const prev = f[k - 1]; // last row before ex
    if (prev.v <= 0 || cur.v <= 0) continue;
    const stepMag = Math.abs(Math.log(cur.v / prev.v)); // symmetric magnitude
    if (stepMag <= Math.log(1 + SPINOFF_FACTOR_STEP)) continue; // dividend-sized → ignore
    if (nearSplit(cur.t)) continue; // handled by adjustForSplits — don't double-adjust
    const M = prev.v / cur.v; // factor to scale PRE-ex closes onto the ex basis
    if (!(M > 0) || Math.abs(Math.log(M)) <= Math.log(1 + SPINOFF_FACTOR_STEP)) continue;
    for (let i = 0; i < cur.idx; i++) out[i][1] = out[i][1] * M;
    applied.push(cur.t);
  }

  applied.sort((a, b) => a - b);
  return { daily: out, applied };
}

/**
 * Convenience wrapper: apply the split countermeasure, then the spinoff countermeasure,
 * to a daily close series. `adjclose` is optional — omit it (or pass []) to run splits
 * only. Pure; returns the corrected series plus the dates each pass adjusted.
 */
export function adjustForCorporateActions(
  daily: [number, number][],
  splits: SplitEvent[],
  adjclose: [number, number][] = [],
): { daily: [number, number][]; splitApplied: number[]; spinoffApplied: number[] } {
  const s = adjustForSplits(daily, splits);
  const sp = adjustForSpinoffs(
    s.daily,
    adjclose,
    splits.map((e) => e.date),
  );
  return { daily: sp.daily, splitApplied: s.applied, spinoffApplied: sp.applied };
}
