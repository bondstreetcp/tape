/**
 * Named preset stock screens (value/quality factor strategies), shared by the
 * Screener UI and the backtester so a screen and its backtest hold exactly the
 * same names. Each returns the passing symbols in the screen's natural rank order
 * (best first). All run off the snapshot's per-stock `fund` metrics + valuation.
 */
import type { StockRow } from "./types";

export type ScreenKey = "magic" | "netnet" | "piotroski" | "shyield";
export interface ScreenOpts { topN?: number; pioMin?: number }

export const SCREEN_LABEL: Record<ScreenKey, string> = {
  magic: "Magic Formula (Greenblatt)",
  netnet: "Net-Net / NCAV (Graham)",
  piotroski: "Piotroski F-Score",
  shyield: "Shareholder Yield (Faber)",
};

/** Detailed, plain-English descriptions for the strategy tooltip + the beta-tester guide. */
export const SCREEN_INFO: Record<ScreenKey, { name: string; what: string; how: string; read: string }> = {
  magic: {
    name: "Magic Formula (Greenblatt)",
    what: "Joel Greenblatt's “Little Book That Beats the Market” strategy — buy good businesses at cheap prices.",
    how: "Ranks every company two ways — by earnings yield (how cheap) and by return on capital (how good) — sums the two ranks, and takes the best names. We proxy earnings yield with 1/(P/E) and return-on-capital with ROE; financials & utilities are excluded (the capital math doesn't fit) along with sub-$500M caps.",
    read: "Lower combined rank = better; the list is shown best-first. Use the Top-N selector to widen/narrow it.",
  },
  netnet: {
    name: "Net-Net / NCAV (Graham)",
    what: "Ben Graham's deepest value screen — buying a dollar of working capital for less than a dollar, with the business thrown in free.",
    how: "NCAV (net current asset value) = current assets − ALL liabilities, ignoring every fixed asset (plants, goodwill, brands). A “net-net” trades below its NCAV, so you're paying less than a conservative liquidation value.",
    read: "The Mkt / NCAV column: below 1.0 = under liquidation value; below 0.67× = Graham's strict net-net (green). Extremely rare in large caps (usually zero in the S&P 500) — switch to Broad 1500 or Russell 3000 to find them.",
  },
  piotroski: {
    name: "Piotroski F-Score (0–9)",
    what: "Joseph Piotroski's 9-point checklist of fundamental strength — it separates financially improving companies from deteriorating ones.",
    how: "One point each for: positive return on assets, positive operating cash flow, rising ROA, cash flow greater than net income (earnings quality), falling leverage, rising current ratio, no new share issuance, rising gross margin, and rising asset turnover.",
    read: "7–9 = strengthening (green), 0–3 = weakening (red). Set the minimum with the F-Score selector. Classic use: pair a high F-Score with cheap valuation to avoid value traps.",
  },
  shyield: {
    name: "Shareholder Yield (Faber)",
    what: "Meb Faber's total cash-return measure — every way a company hands cash back to owners, not just the dividend.",
    how: "Dividend yield + net buyback yield (how much the share count shrank) + net debt-paydown yield. The buyback & debt pieces are clamped to ±20% so a one-off spinoff or big deleveraging doesn't distort the ranking.",
    read: "Higher = more cash returned per dollar of market value; shown top-N first. A high yield from buybacks + debt paydown (not just dividends) is the signal Faber found most powerful.",
  },
};

export function screenSymbols(key: ScreenKey, stocks: StockRow[], opts: ScreenOpts = {}): string[] {
  const topN = opts.topN ?? 30;
  const pioMin = opts.pioMin ?? 7;

  if (key === "netnet") {
    // Graham deep value: market cap below net current asset value (rare outside small caps).
    return stocks
      .filter((s) => { const n = s.fund?.ncav; return n != null && n > 0 && s.marketCap < n; })
      .sort((a, b) => a.marketCap / a.fund!.ncav! - b.marketCap / b.fund!.ncav!) // deepest discount first
      .map((s) => s.symbol);
  }

  if (key === "piotroski") {
    return stocks
      .filter((s) => (s.fund?.fScore ?? -1) >= pioMin)
      .sort((a, b) => (b.fund!.fScore ?? 0) - (a.fund!.fScore ?? 0))
      .map((s) => s.symbol);
  }

  if (key === "shyield") {
    return stocks
      .filter((s) => s.fund?.shareholderYield != null)
      .sort((a, b) => b.fund!.shareholderYield! - a.fund!.shareholderYield!)
      .slice(0, topN)
      .map((s) => s.symbol);
  }

  // Magic Formula (Greenblatt): earnings-yield rank + return-on-capital rank, summed,
  // best N. Proxy earnings yield with 1/(P/E), return-on-capital with ROE; ex financials
  // & utilities, ≥$500M cap.
  const valid = stocks.filter(
    (s) => (s.trailingPE ?? 0) > 0 && s.fund?.roe != null && s.etf !== "XLF" && s.etf !== "XLU" && (s.marketCap || 0) >= 5e8,
  );
  if (valid.length < 20) return [];
  const ey = new Map<string, number>();
  [...valid].sort((a, b) => 1 / b.trailingPE! - 1 / a.trailingPE!).forEach((s, i) => ey.set(s.symbol, i));
  const roc = new Map<string, number>();
  [...valid].sort((a, b) => b.fund!.roe! - a.fund!.roe!).forEach((s, i) => roc.set(s.symbol, i));
  return valid
    .map((s) => ({ sym: s.symbol, score: ey.get(s.symbol)! + roc.get(s.symbol)! }))
    .sort((a, b) => a.score - b.score)
    .slice(0, topN)
    .map((x) => x.sym);
}
