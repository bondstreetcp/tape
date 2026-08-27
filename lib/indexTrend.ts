/**
 * Long-run index valuation via a LOG-LINEAR trend channel — the classic "how cheap/dear is the market
 * vs its own long-term exponential growth trend" lens. We OLS-fit ln(price) on time, then draw ±1σ/±2σ
 * (~68% / ~95%) residual bands around the trend; where price sits in the channel = the read.
 *
 * CLIENT-SAFE: types + presentation helpers only (no fs/network). Built by scripts/refresh-index-trend.ts,
 * read server-side by lib/indexTrendServer.ts, rendered by <IndexTrendPanel/>. Descriptive, not
 * predictive — reversion to a fitted trend is not guaranteed, and the fit is sensitive to the start year.
 */
export type TrendVerdict = "very cheap" | "cheap" | "fair" | "rich" | "very rich";

// Compact per-point tuple for the channel chart: [tMs, price, trend, lo1, hi1, lo2, hi2]
export type TrendPoint = [number, number, number, number, number, number, number];

export interface IndexTrend {
  key: string; // "sp500"
  label: string; // "S&P 500"
  symbol: string; // provenance, e.g. "^GSPC"
  startYear: number; // first year of the fit
  nMonths: number; // observations in the fit
  cagrPct: number; // fitted annual trend growth (exp(slope)-1)
  current: number; // latest price
  currentDate: string; // YYYY-MM-DD
  trendNow: number; // fitted trend value at now
  pctFromTrend: number; // (current/trendNow - 1) * 100 — % above/below the trend line
  z: number; // standard deviations above/below trend (log space) — the channel position
  sigma1Pct: number; // 1σ band half-width, % (exp(σ)-1)
  verdict: TrendVerdict;
  history: TrendPoint[]; // downsampled, oldest→newest
  source: string;
}

export interface IndexTrendData {
  asOf: string;
  indices: IndexTrend[];
}

export const VERDICT_COLOR: Record<TrendVerdict, string> = {
  "very cheap": "#16a34a",
  cheap: "#22c55e",
  fair: "var(--text-2)",
  rich: "#f59e0b",
  "very rich": "#ef4444",
};

export function verdictFromZ(z: number): TrendVerdict {
  if (z <= -2) return "very cheap";
  if (z <= -1) return "cheap";
  if (z < 1) return "fair";
  if (z < 2) return "rich";
  return "very rich";
}

export const fmtIdx = (v: number | null): string =>
  v == null ? "—" : v >= 1000 ? v.toLocaleString("en-US", { maximumFractionDigits: 0 }) : v.toFixed(1);
export const signPct = (v: number | null): string => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
