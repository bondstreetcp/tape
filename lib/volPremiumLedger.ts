/**
 * VRP capture ledger (/vol-dislocation → "does selling the rich-vol decile actually pay?").
 *
 * /vol-dislocation surfaces where option vol is RICH (ATM IV ÷ realized vol). But a rich-vol screen
 * is a HYPOTHESIS, not a track record — rich vol can be rich because a real catalyst is coming, in
 * which case realized vol prints ABOVE the implied you sold and the premium seller loses. Directional
 * grading (the /signal-record engine) is the wrong metric here: a short-vol position wins when realized
 * comes in BELOW the implied you sold, regardless of which way the stock went. So this ledger grades the
 * board on its OWN axis:
 *
 *   1. Each night, freeze the top liquid rich-vol picks — the ATM IV you'd have SOLD.
 *   2. MATURE_TD (20) trading days later, read that name's realized vol (vol-cone cur20 = the RV that
 *      actually printed over ~the holding window) and score:  capturedVolPts = atmIV_sold − rv_realized.
 *
 * capturedVolPts is the IDEALIZED, delta-hedged straddle seller's edge in annualized vol points. It is
 * an UPPER BOUND on real P&L — it ignores bid/ask (you sell at the bid, not mid), discrete-hedging error,
 * and gamma/vega path. So the honest headline is the HIT RATE (share of picks where IV > realized) and
 * the MEDIAN captured, both reported pre-cost. Pure types + math here; the nightly engine does the I/O.
 */

import type { VolDisRow } from "./volDislocation";

/** The realized-vol window we grade against: vol-cone's cur20 is a 20-trading-day RV, so an entry read
 *  20 td later covers ~the holding period. Also the "sell front-month, hold ~a month" horizon a premium
 *  seller actually runs. */
export const MATURE_TD = 20;

/** Past maturity, a name can drop out of vol-cone (delisted, halted, acquired) so no RV is available to
 *  grade it. Keep waiting up to this many trading days past maturity, then discard as ungradeable rather
 *  than inventing a number. */
export const MAX_HOLD_TD = 32;

/** Don't open a fresh position on a name that already has one open, or that closed within this many
 *  calendar days — rich vol persists for weeks and we want roughly non-overlapping monthly samples. */
export const RELOG_COOLDOWN_DAYS = 30;

/** Match vol-dislocation's IV/RV floor (0.08): a realized vol below this is a flat/halted/stale series
 *  artifact, not a real read. Grading atmIV − (glitch-low RV) would book a fake near-maximal capture. */
export const RV_FLOOR = 0.08;

/** The realized-vol feed (vol-cone) and the aging clock (vol-dislocation) are SEPARATE feeds that fail
 *  independently — and the feed-guard doctrine keeps a STALE file on a failed refresh. If the cone's
 *  stamp sits more than this many calendar days from the grading clock, cur20's 20-td window no longer
 *  covers [entry, maturity] (it can end weeks before maturity, missing the terminal blow-up), so the
 *  close must be DEFERRED, not booked against a misaligned window. */
export const CONE_TOLERANCE_DAYS = 3;

/** How many of the richest picks to freeze per night. */
export const OPEN_PER_NIGHT = 40;

/** Keep the closed ledger bounded. */
export const CLOSED_CAP = 750;

export interface VpOpen {
  symbol: string;
  name: string;
  sector: string;
  /** Calendar date (YYYY-MM-DD) the pick was frozen — the entry, anchored to the source feed's stamp. */
  entryDate: string;
  /** The ATM IV you'd have SOLD (annualized decimal, 0.45 = 45%). */
  atmIVEntry: number;
  /** Realized vol at entry (context — the starting IV/RV gap). */
  rvolEntry: number;
  /** atmIV ÷ rvol at entry — the richness that got it picked. */
  ivPremiumEntry: number;
  /** Cross-sectional richness percentile at entry (0–100). */
  pctileEntry: number;
  priceEntry: number;
}

export interface VpClosed extends VpOpen {
  /** Date the position matured and was graded. */
  maturedDate: string;
  /** Realized vol that printed over the holding window (vol-cone cur20 at maturity, annualized decimal). */
  rvRealized: number;
  /** atmIVEntry − rvRealized — annualized vol points captured (idealized, pre-cost). >0 = seller won. */
  capturedVolPts: number;
  /** capturedVolPts ÷ atmIVEntry — the fraction of the sold premium kept (a scale-free read). */
  capturedFrac: number;
  /** IV sold exceeded realized — the premium seller was directionally right on vol. */
  won: boolean;
}

export interface VpStats {
  n: number;
  /** Share of closed picks where IV_sold > realized (the honest headline). */
  hitRate: number;
  /** Median annualized vol points captured (idealized, pre-cost). */
  medianCaptured: number;
  meanCaptured: number;
  /** Median fraction of the sold premium kept (captured ÷ IV). */
  medianCapturedFrac: number;
  /** The catalyst blow-ups — realized blew past the implied you sold (biggest losses first). */
  worst: { symbol: string; capturedVolPts: number; entryDate: string }[];
  best: { symbol: string; capturedVolPts: number; entryDate: string }[];
}

export interface VpLedgerFile {
  generatedAt: string;
  open: VpOpen[];
  closed: VpClosed[];
  stats: VpStats | null;
}

/** Count Mon–Fri days strictly after `a` up to and including `b` (a ≤ b). An approximation of trading
 *  days — holidays are ignored, immaterial for a ~20-day vol window. Returns 0 if b ≤ a. */
export function bizDaysBetween(a: string, b: string): number {
  const start = new Date(a + "T00:00:00Z");
  const end = new Date(b + "T00:00:00Z");
  if (!(end > start)) return 0;
  let n = 0;
  const d = new Date(start);
  for (;;) {
    d.setUTCDate(d.getUTCDate() + 1);
    if (d > end) break;
    const wd = d.getUTCDay();
    if (wd !== 0 && wd !== 6) n++;
  }
  return n;
}

/** Calendar days between two YYYY-MM-DD dates (b − a), for the re-log cooldown. */
export function calDaysBetween(a: string, b: string): number {
  const ms = new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime();
  return Math.round(ms / 86_400_000);
}

/** Idealized vol points a delta-hedged straddle seller captures: IV sold minus realized printed. */
export function capturedVolPts(atmIVEntry: number, rvRealized: number): number {
  return atmIVEntry - rvRealized;
}

/** Is a vol-cone cur20 read usable for grading? Rejects null and glitch-low RV (flat/halted series). */
export function rvUsable(cur20: number | null | undefined): boolean {
  return cur20 != null && cur20 >= RV_FLOOR;
}

/** Is the realized-vol feed fresh enough (vs the aging clock) that cur20's window covers the holding
 *  period? A cone stamped far from `today` grades a misaligned window → defer the close instead. */
export function coneFreshEnough(coneDate: string, today: string, tol = CONE_TOLERANCE_DAYS): boolean {
  return Math.abs(calDaysBetween(coneDate, today)) <= tol;
}

export type MaturityAction = "hold-immature" | "discard-overhold" | "grade" | "defer";

/** The close-loop decision for ONE open position — pure, so the state machine the review scrutinized is
 *  directly testable rather than buried in the engine. Order matters:
 *   1. td < MATURE_TD                     → hold (not yet matured)
 *   2. td > MAX_HOLD_TD                    → DISCARD, even if an RV is present: the cur20 window no longer
 *      overlaps [entry, maturity], so grading it would be dishonest (finding 4).
 *   3. cone fresh AND rv usable            → GRADE.
 *   4. otherwise (stale cone / glitch-low / missing rv) → DEFER within the grace window (findings 1/2/5/10). */
export function maturityDecision(td: number, coneFresh: boolean, rv: number | null | undefined): MaturityAction {
  if (td < MATURE_TD) return "hold-immature";
  if (td > MAX_HOLD_TD) return "discard-overhold";
  if (coneFresh && rvUsable(rv)) return "grade";
  return "defer";
}

/**
 * The "sell rich vol" picks from a vol-dislocation snapshot, richest (most cross-sectionally rich) first.
 * The gates keep the ledger's IV inputs honest:
 *  - !earningsDriven: rich vol into a print is EXPECTED compensation, not a dislocation to harvest.
 *  - !illiquid: thin-option IV is unreliable — the whole read hinges on a real ATM IV.
 *  - ivPremium in [minPremium, PREMIUM_CEIL] and atmIV ≤ IV_CEIL: absurd richness is almost always a
 *    data artifact (a stale/mis-tagged quote), not a tradable edge — the plausibility-ceiling doctrine.
 */
export const PREMIUM_CEIL = 6;
export const IV_CEIL = 2.0; // 200% annualized — above this is a binary/biotech or bad data, not sellable premium
export function pickSellCandidates(
  rows: VolDisRow[],
  opts: { maxN?: number; minPremium?: number; minPctile?: number; minPrice?: number } = {},
): VolDisRow[] {
  const maxN = opts.maxN ?? OPEN_PER_NIGHT;
  const minPremium = opts.minPremium ?? 1.4;
  const minPctile = opts.minPctile ?? 90;
  const minPrice = opts.minPrice ?? 3;
  return rows
    .filter(
      (r) =>
        !r.earningsDriven &&
        !r.illiquid &&
        r.atmIV > 0 &&
        r.atmIV <= IV_CEIL &&
        r.rvol > 0 &&
        r.ivPremium >= minPremium &&
        r.ivPremium <= PREMIUM_CEIL &&
        r.pctile >= minPctile &&
        r.price >= minPrice,
    )
    .sort((a, b) => b.pctile - a.pctile || b.ivPremium - a.ivPremium)
    .slice(0, maxN);
}

const median = (xs: number[]): number => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

export function computeStats(closed: VpClosed[]): VpStats | null {
  if (!closed.length) return null;
  const caps = closed.map((c) => c.capturedVolPts);
  const byCap = [...closed].sort((a, b) => a.capturedVolPts - b.capturedVolPts);
  const pick = (c: VpClosed) => ({ symbol: c.symbol, capturedVolPts: c.capturedVolPts, entryDate: c.entryDate });
  return {
    n: closed.length,
    hitRate: closed.filter((c) => c.won).length / closed.length,
    medianCaptured: median(caps),
    meanCaptured: caps.reduce((s, x) => s + x, 0) / caps.length,
    medianCapturedFrac: median(closed.map((c) => c.capturedFrac)),
    worst: byCap.slice(0, 5).map(pick),
    best: byCap.slice(-5).reverse().map(pick),
  };
}
