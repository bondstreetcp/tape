/**
 * SPAC trust-value arbitrage (/spac-arb) — the size-locked play: SPACs trading BELOW their trust
 * redemption value are a low-risk floor institutions can't fit into. Pure types + extraction math;
 * the nightly engine (scripts/refresh-spac-arb) does the SEC/Yahoo I/O.
 *
 * HONESTY, baked in (the recon's three traps):
 *  1. STALENESS — trust$ is as of the last 10-Q; a redemption/extension (in an 8-K, not the 10-Q)
 *     moves it between filings. Every row stamps its trust as-of date + days stale.
 *  2. REDEMPTION-GATED, not market-gated — "below trust" is only collectable by REDEEMING at the
 *     next vote/deadline; you're buying locked capital with an uncertain horizon. Never "riskless".
 *  3. BELOW-TRUST IS OFTEN A SIGNAL, not a gift — thin float / imminent delisting / a disliked deal.
 *     The screen surfaces trust size, shares, and the PINK flag so the discount can be read in context.
 *
 * Per-share is COMPUTED (trust$ ÷ redeemable shares), never trusted from the sparse, lagging
 * TemporaryEquityRedemptionPricePerShare tag — that tag is a cross-check only.
 */

/** SPAC trusts sit near the $10 IPO price + accrued interest; anything outside this band is a
 *  commodity/holding trust the frame also catches (iShares Gold computes to $30–86). The gate. */
export const SPAC_TRUST_BAND: [number, number] = [9.0, 13.5];

/** Redeemable-share concepts, in the order to try — filers tag exactly one, inconsistently. The
 *  denominator MUST be read at the same period-end as the trust asset (see engine). */
export const SHARE_CONCEPTS = [
  "TemporaryEquitySharesOutstanding",
  "TemporaryEquitySharesIssued",
  "CommonStockSharesSubjectToPossibleRedemption",
  "TemporaryEquitySharesAuthorized",
] as const;

export interface SpacRow {
  ticker: string;
  cik: string;
  name: string;
  /** AssetsHeldInTrust, freshest reported end ($). */
  trustUsd: number;
  /** Balance-sheet date the trust figure is as-of (YYYY-MM-DD) — the staleness anchor. */
  trustEnd: string;
  daysStale: number;
  /** Redeemable shares at trustEnd. */
  shares: number;
  /** Which XBRL concept supplied `shares` — provenance for the read. */
  sharesConcept: string;
  /** trustUsd / shares — the redemption floor per share. */
  trustPerShare: number;
  /** The filer's own redemption-price tag, when present — a cross-check, not the source. */
  ppsTag: number | null;
  /** |computed − tag| > 2% — flags a stale/odd filing worth a manual look. */
  ppsMismatch: boolean;
  /** Live Yahoo price; null when Yahoo doesn't cover the ticker (~40% of SPACs). */
  price: number | null;
  /** Yahoo exchange code — a PINK/OTC flag means a thin book that eats the edge. */
  exchange: string | null;
  /** (trustPerShare − price) / trustPerShare — positive = trading BELOW trust (the arb). null unpriced. */
  discountPct: number | null;
}

export interface SpacArbFile {
  generatedAt: string;
  /** SPACs in the trust band with a computable per-share (the universe). */
  universe: number;
  /** Of those, how many Yahoo priced. */
  priced: number;
  rows: SpacRow[];
}

/** Redemption floor per share. null on a degenerate denominator. */
export function trustPerShare(trustUsd: number, shares: number): number | null {
  return shares > 0 && trustUsd > 0 ? trustUsd / shares : null;
}

/** Discount to trust: positive = the stock trades below its redemption floor (the opportunity). */
export function discountPct(perShare: number, price: number | null): number | null {
  if (price == null || !(price > 0) || !(perShare > 0)) return null;
  return (perShare - price) / perShare;
}
