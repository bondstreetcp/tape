/**
 * Suggested hedge basket for the Portfolio Cockpit — how to flatten the book's biggest systematic bets
 * with liquid ETFs. The MARKET leg is exact (short Σ value·β of SPY). The STYLE legs neutralize the
 * largest factor tilts: a factor ETF (MTUM, VLUE, …) is ~+1σ loaded on its factor, so ~|tilt|·gross of
 * it, traded against the tilt, pulls that tilt toward zero — a first-order starting size, not an
 * optimizer's answer (ETF factor loadings aren't modelled from free data). Pure + fs-free →
 * unit-tested (tests/hedge.test.ts). Doctrine: code computes the stat, no LLM.
 */

import type { FactorKey, FactorTilt } from "./factors";

/** Liquid ETF menu the risk-minimizing hedge optimizer solves over (market / style / sector). Sector
 *  ETFs carry their GICS sector (strings match the stock snapshots), so a sector-ETF hedge nets against
 *  the book's own sector exposure; broad/style ETFs have none (they span sectors → "ETF/Index"). */
export const HEDGE_ETFS: { etf: string; name: string; sector?: string }[] = [
  { etf: "SPY", name: "S&P 500" }, { etf: "QQQ", name: "Nasdaq 100" },
  { etf: "IWM", name: "Russell 2000" }, { etf: "MDY", name: "S&P MidCap 400" },
  { etf: "MTUM", name: "Momentum" }, { etf: "VLUE", name: "Value" },
  { etf: "QUAL", name: "Quality" }, { etf: "USMV", name: "Min Vol" },
  { etf: "IWF", name: "Growth" }, { etf: "IWD", name: "Value (R1000)" },
  { etf: "XLK", name: "Technology", sector: "Information Technology" },
  { etf: "XLF", name: "Financials", sector: "Financials" },
  { etf: "XLE", name: "Energy", sector: "Energy" },
  { etf: "XLV", name: "Health Care", sector: "Health Care" },
  { etf: "XLI", name: "Industrials", sector: "Industrials" },
  { etf: "XLY", name: "Cons. Disc.", sector: "Consumer Discretionary" },
  { etf: "XLP", name: "Cons. Staples", sector: "Consumer Staples" },
  { etf: "XLU", name: "Utilities", sector: "Utilities" },
];
export const HEDGE_ETF_NAME: Record<string, string> = Object.fromEntries(HEDGE_ETFS.map((e) => [e.etf, e.name]));
export const HEDGE_ETF_SECTOR: Record<string, string> = Object.fromEntries(HEDGE_ETFS.map((e) => [e.etf, e.sector ?? "ETF/Index"]));

export interface HedgeLeg {
  etf: string;
  name: string;
  action: "Short" | "Buy";
  notional: number; // positive $ magnitude
  cuts: string; // what it neutralizes, e.g. "market β" or "Momentum +1.8σ"
  exact: boolean; // market leg is exact; style legs are first-order estimates
}

// Long-the-factor ETF proxies (each ~+1σ on its own factor vs the broad market).
const FACTOR_ETF: Partial<Record<FactorKey, { etf: string; name: string }>> = {
  momentum: { etf: "MTUM", name: "iShares MSCI USA Momentum" },
  value: { etf: "VLUE", name: "iShares MSCI USA Value" },
  quality: { etf: "QUAL", name: "iShares MSCI USA Quality" },
  growth: { etf: "IWF", name: "iShares Russell 1000 Growth" },
  yield: { etf: "VYM", name: "Vanguard High Dividend Yield" },
  lowvol: { etf: "USMV", name: "iShares MSCI USA Min Vol" },
};

export function buildHedge(
  tilts: FactorTilt[],
  netBetaDollar: number | null,
  gross: number,
  opts: { minTilt?: number; maxLegs?: number } = {},
): HedgeLeg[] {
  const { minTilt = 0.5, maxLegs = 3 } = opts;
  const legs: HedgeLeg[] = [];

  // Market leg — exact: short (or buy) Σ value·β of SPY to flatten market exposure.
  if (netBetaDollar != null && Math.abs(netBetaDollar) >= 0.01 * (gross || 1)) {
    legs.push({
      etf: "SPY", name: "SPDR S&P 500",
      action: netBetaDollar > 0 ? "Short" : "Buy",
      notional: Math.abs(netBetaDollar), cuts: "market β", exact: true,
    });
  }

  // Style legs — the largest tilts we have a proxy for (tilts arrive sorted by |tilt| desc).
  for (const t of tilts) {
    if (legs.filter((l) => !l.exact).length >= maxLegs) break;
    const proxy = FACTOR_ETF[t.key];
    if (!proxy || t.coverage <= 0 || Math.abs(t.tilt) < minTilt) continue;
    legs.push({
      etf: proxy.etf, name: proxy.name,
      action: t.tilt > 0 ? "Short" : "Buy", // tilted toward the factor → short the factor ETF to cut it
      notional: Math.abs(t.tilt) * (gross || 0),
      cuts: `${t.label} ${t.tilt >= 0 ? "+" : "−"}${Math.abs(t.tilt).toFixed(1)}σ`,
      exact: false,
    });
  }
  return legs;
}
