/**
 * IPO financials & valuation — the structured fundamentals a recent IPO discloses (revenue trajectory,
 * margins, profitability, cash, debt) pulled from its SEC XBRL facts, joined with a market-cap-based
 * price-to-sales so the deal can be judged on more than a one-line recap. The LLM writes a grounded
 * value read FROM these computed numbers — it never invents a figure.
 *
 * CLIENT-SAFE: types + pure derivation only (no fs, no network). The fetch lives in scripts/refresh-ipo.
 */

export interface IpoFiscalYear {
  year: string; // fiscal-year-end year, e.g. "2025"
  revenue: number | null;
  grossProfit: number | null;
  netIncome: number | null;
}

export interface IpoFinancials {
  years: IpoFiscalYear[]; // oldest → newest, up to ~3
  revenue: number | null; // latest FY revenue ($)
  revenueGrowthPct: number | null; // latest FY vs prior FY
  grossMarginPct: number | null;
  netMarginPct: number | null;
  profitable: boolean | null; // latest FY net income > 0
  cash: number | null;
  debt: number | null;
  sharesOutstanding: number | null;
  marketCap: number | null; // shares × current (or offer) price
  priceToSales: number | null; // marketCap / latest revenue
  valueTag: "cheap" | "fair" | "rich" | "unclear"; // code+LLM verdict
  valueRead: string; // one grounded sentence
  asOf: string; // ISO date the facts were read
}

const pct = (n: number | null, d: number | null): number | null =>
  n != null && d != null && d !== 0 ? +((n / d) * 100).toFixed(1) : null;

/** Derive the valuation metrics from the raw annual series + a market cap input. Pure + testable. */
export function deriveIpoMetrics(input: {
  years: IpoFiscalYear[]; // oldest → newest
  cash: number | null;
  debt: number | null;
  sharesOutstanding: number | null;
  price: number | null; // current or offer price for the market cap
}): Omit<IpoFinancials, "valueTag" | "valueRead" | "asOf"> {
  const years = input.years.slice(-3);
  const latest = years[years.length - 1] ?? null;
  const prior = years[years.length - 2] ?? null;
  const revenue = latest?.revenue ?? null;
  const revenueGrowthPct = latest?.revenue != null && prior?.revenue != null && prior.revenue !== 0 ? +(((latest.revenue - prior.revenue) / Math.abs(prior.revenue)) * 100).toFixed(1) : null;
  const grossMarginPct = pct(latest?.grossProfit ?? null, revenue);
  const netMarginPct = pct(latest?.netIncome ?? null, revenue);
  const marketCap = input.sharesOutstanding != null && input.price != null && input.sharesOutstanding > 0 && input.price > 0 ? input.sharesOutstanding * input.price : null;
  const priceToSales = marketCap != null && revenue != null && revenue > 0 ? +(marketCap / revenue).toFixed(1) : null;
  return {
    years,
    revenue,
    revenueGrowthPct,
    grossMarginPct,
    netMarginPct,
    profitable: latest?.netIncome != null ? latest.netIncome > 0 : null,
    cash: input.cash ?? null,
    debt: input.debt ?? null,
    sharesOutstanding: input.sharesOutstanding ?? null,
    marketCap,
    priceToSales,
  };
}

export const valueTagColor = (t: IpoFinancials["valueTag"]): string =>
  t === "cheap" ? "#22c55e" : t === "rich" ? "#ef4444" : t === "fair" ? "#f59e0b" : "var(--text-3)";

/** Compact $ label for the financials table. */
export function fmtUsd(n: number | null | undefined): string {
  if (n == null) return "—";
  const a = Math.abs(n), s = n < 0 ? "−" : "";
  if (a >= 1e9) return `${s}$${(a / 1e9).toFixed(a >= 1e10 ? 0 : 1)}B`;
  if (a >= 1e6) return `${s}$${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${s}$${(a / 1e3).toFixed(0)}K`;
  return `${s}$${a.toFixed(0)}`;
}
