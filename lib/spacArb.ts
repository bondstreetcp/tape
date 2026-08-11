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

/** A genuine pre-deal SPAC common cannot rationally trade far below its own redemption floor —
 *  arbitrageurs would redeem. A "discount" past this is almost always a data problem: a stale trust
 *  after the deal closed (trust distributed), or a mispicked non-common listing (a right/warrant).
 *  Rows above it are flagged UNVERIFIED, kept out of the opportunity count, and never shown green. */
export const PLAUSIBLE_MAX_DISCOUNT = 0.15;

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
  /** Redeemable shares at sharesEnd. */
  shares: number;
  /** Which XBRL concept supplied `shares` — provenance for the read. */
  sharesConcept: string;
  /** The share count's OWN balance-sheet date — may lag trustEnd; daysStale reports the OLDER. */
  sharesEnd: string;
  /** trustUsd / shares — the computed floor. Transparency; the discount uses `floorPerShare`. */
  trustPerShare: number;
  /** The filer's own redemption-price tag, when present. */
  ppsTag: number | null;
  /** The floor the discount is measured against: the filer's redemption tag when present (it nets
   *  out tax-earmarked interest that trust÷shares over-counts), else computed; the LOWER of the two
   *  when they disagree >2% (conservative — never flatter the discount). */
  floorPerShare: number;
  /** "tag" | "computed" | "conservative" — where floorPerShare came from. */
  floorSource: "tag" | "computed" | "conservative";
  /** computed vs tag disagree >2% — a stale/odd filing worth a manual look. */
  ppsMismatch: boolean;
  /** Live Yahoo price; null when Yahoo doesn't cover the ticker (~40% of SPACs). */
  price: number | null;
  /** Yahoo exchange code — a PINK/OTC flag means a thin book that eats the edge. */
  exchange: string | null;
  /** (floorPerShare − price) / floorPerShare — positive = trading BELOW the floor. null unpriced. */
  discountPct: number | null;
  /** discount > PLAUSIBLE_MAX_DISCOUNT — a real pre-deal common can't; the trust is stale (post-deal)
   *  or the listing isn't the common. Kept out of the opportunity count, never shown green. */
  implausible: boolean;
}

export interface SpacArbFile {
  generatedAt: string;
  /** SPACs in the trust band with a computable per-share (the universe). */
  universe: number;
  /** Of those, how many Yahoo priced. */
  priced: number;
  rows: SpacRow[];
}

/** Hard derivative-ticker forms (separated OR unambiguous multi-char bare): warrant/right/unit.
 *  Bare single-letter U/W/R are NOT here — real commons end that way (BOW, NU, PTOR); pickCommon's
 *  prefix test + the plausibility ceiling catch the derivative cases without false-dropping legit ones. */
export const HARD_DERIV = /(?:[-.](WS?|WT|RT|UN?|R))$|(WS|WT|UN|RT)$/i;

function longestCommonPrefix(xs: string[]): string {
  if (!xs.length) return "";
  let p = xs[0];
  for (const s of xs) { while (!s.startsWith(p)) p = p.slice(0, -1); if (!p) break; }
  return p;
}

/** The COMMON share among a CIK's listings, never a warrant/right/unit. In order:
 *  (1) a listed base that all others extend (IROQ ⊂ IROQR/IROQW) → the common;
 *  (2) several listings extending a MISSING shorter base (IROQW+IROQR share unlisted IROQ) → the
 *      common isn't listed → drop;
 *  (3) a single / unrelated listing → keep, unless it is an unambiguous derivative form. Bare
 *      single-letter U/W/R survive here (BOW/NU/PTOR) — the plausibility ceiling catches the ones
 *      that are actually lone derivatives (they price at cents → a >15% "discount" → unverified). */
export function pickCommon<T extends { ticker: string }>(list: T[]): T | null {
  if (!list.length) return null;
  const base = [...list].sort((a, b) => a.ticker.length - b.ticker.length)[0];
  if (list.length > 1 && list.every((x) => x.ticker === base.ticker || x.ticker.startsWith(base.ticker))) return base;
  if (list.length > 1) {
    const lcp = longestCommonPrefix(list.map((x) => x.ticker));
    if (lcp.length >= 2 && list.every((x) => x.ticker.length > lcp.length)) return null; // all extend a missing base
  }
  return HARD_DERIV.test(base.ticker) ? null : base;
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
