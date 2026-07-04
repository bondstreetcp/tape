/**
 * Earnings-move seasonality — which names SYSTEMATICALLY move more (or less) on earnings than on a normal
 * day. Per name: the average |post-earnings move| over its recent prints vs its typical daily move (from
 * realized vol) → an "earnings amplifier". High amplifier = the print is a real event (a straddle-buyer's
 * name historically); low = quiet earnings (a premium-seller's name).
 *
 * ⚠ APPROXIMATE: this backtests the REALIZED earnings move vs a realized-vol baseline — NOT a true bought/
 * sold-straddle P&L, because the app doesn't store the historical IMPLIED vol (what the straddle cost) at
 * each past print. So it says "does this name move big on earnings", not "was the straddle rich/cheap then".
 * Client-safe types + helpers only. Built by scripts/refresh-seasonality.ts.
 */
export interface SeasonRow {
  symbol: string;
  name: string;
  sector: string;
  n: number; // past prints used
  avgAbsMovePct: number; // average |earnings-day move|, %
  dailyMovePct: number; // typical 1-day move from realized vol, %
  amplifier: number; // avgAbsMove ÷ dailyMove — how much earnings amplifies a normal day
  bigRate: number; // fraction of prints that moved > 2× a normal day
  upBias: number; // average SIGNED move, % (directional lean over the sample)
  avgDrift5: number | null; // average 5-session post-earnings drift, %
}
export interface SeasonData {
  generatedAt: string;
  scanned: number;
  rows: SeasonRow[];
}

// amplifier color: high = big mover (amber), low = quiet (teal)
export const ampColor = (a: number): string => (a >= 4 ? "#ef4444" : a >= 2.5 ? "#f59e0b" : a <= 1.5 ? "#14b8a6" : "var(--text-2)");
export const ampRead = (a: number): string =>
  a >= 4 ? "explosive on earnings" : a >= 2.5 ? "big earnings mover" : a <= 1.5 ? "quiet on earnings" : "moderate";
