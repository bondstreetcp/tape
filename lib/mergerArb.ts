/**
 * Merger-arbitrage math. For an announced acquisition we know the consideration per target share
 * (cash, and/or a fixed exchange ratio of acquirer stock) and an expected close; the ARB SPREAD is how
 * much the target trades below that deal value, and the ANNUALIZED return is that spread scaled by the
 * time to close. Pure + fs-free (unit-tested) — the deal terms are LLM-extracted + grounded upstream.
 * Doctrine: the LLM proposes the deal terms; this code computes the spread.
 */

export type DealStructure = "cash" | "stock" | "mixed";

export interface Deal {
  targetTicker: string;
  targetName: string;
  acquirer: string;
  acquirerTicker: string | null; // needed to value a stock/mixed deal
  structure: DealStructure;
  cashPerShare: number | null; // $ cash per target share
  exchangeRatio: number | null; // acquirer shares received per target share
  cvr: boolean; // a contingent value right is attached (extra, unvalued upside)
  expectedClose: string | null; // ISO 'YYYY-MM-DD' best estimate
  announced: string | null; // ISO
  url: string;
}

export interface ArbRow extends Deal {
  targetPrice: number | null;
  acquirerPrice: number | null;
  dealValue: number | null; // consideration per target share, $
  grossSpreadPct: number | null; // (dealValue − targetPrice) / targetPrice, %
  daysToClose: number | null;
  annualizedPct: number | null; // grossSpread annualized by time to close, %
}

export interface MergerArbData {
  generatedAt: string;
  scanned: number;
  deals: ArbRow[];
}

/** Consideration per target share, in $. Cash + (exchange ratio × acquirer price). null if a required
 *  leg is missing (e.g. a stock deal with no acquirer price). */
export function dealValuePerShare(deal: Pick<Deal, "structure" | "cashPerShare" | "exchangeRatio">, acquirerPrice: number | null): number | null {
  const cash = deal.cashPerShare;
  const ratio = deal.exchangeRatio;
  if (deal.structure === "cash") return cash != null && cash > 0 ? cash : null;
  if (deal.structure === "stock") return ratio != null && ratio > 0 && acquirerPrice != null && acquirerPrice > 0 ? ratio * acquirerPrice : null;
  // mixed: need at least one leg; a missing stock leg (no acquirer price) makes it unknowable
  if (ratio != null && ratio > 0) {
    if (acquirerPrice == null || acquirerPrice <= 0) return null;
    return (cash ?? 0) + ratio * acquirerPrice;
  }
  return cash != null && cash > 0 ? cash : null;
}

const DAY = 86_400_000;

/** Full arb metrics for a deal given the current target (+ acquirer) prices. `nowMs` injected for testability. */
export function arbMetrics(deal: Deal, targetPrice: number | null, acquirerPrice: number | null, nowMs: number): ArbRow {
  const dealValue = dealValuePerShare(deal, acquirerPrice);
  const grossSpreadPct = dealValue != null && targetPrice != null && targetPrice > 0 ? (dealValue / targetPrice - 1) * 100 : null;
  let daysToClose: number | null = null;
  if (deal.expectedClose) {
    const t = Date.parse(deal.expectedClose);
    // A past/same-day close estimate is STALE (deals routinely slip past their guided date) → treat days
    // as unknown so we don't annualize a spread over "1 day" into a nonsense 1000%+; show the gross only.
    if (Number.isFinite(t)) {
      const d = Math.round((t - nowMs) / DAY);
      daysToClose = d >= 1 ? d : null;
    }
  }
  const annualizedPct = grossSpreadPct != null && daysToClose != null ? grossSpreadPct * (365 / daysToClose) : null;
  return { ...deal, targetPrice, acquirerPrice, dealValue, grossSpreadPct, daysToClose, annualizedPct };
}

/** Rank deals for display: widest positive annualized return first; unpriced/negative-spread deals last. */
export function rankArb(rows: ArbRow[]): ArbRow[] {
  const score = (r: ArbRow) => (r.annualizedPct != null ? r.annualizedPct : r.grossSpreadPct != null ? r.grossSpreadPct / 100 : -1e9);
  return [...rows].sort((a, b) => score(b) - score(a));
}
