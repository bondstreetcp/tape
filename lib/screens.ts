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
