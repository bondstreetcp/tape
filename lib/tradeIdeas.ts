/**
 * Trade Desk — a weekly, LLM-narrated shortlist of the top CODE-DETECTED options mispricings. The whole
 * point (and the app's doctrine): code finds and PRICES the mispricing and picks the structure + the hard
 * stat; the LLM only writes the thesis, the key risk, a conviction, and flags traps. The LLM never invents
 * a number or a structure — those are deterministic. See scripts/refresh-trade-ideas.ts.
 *
 * Client-safe: types + pure label/color helpers only.
 */
export type TradeSide = "sell-vol" | "buy-vol" | "buy-event";
export type Conviction = "low" | "medium" | "high";

export interface TradeIdea {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  source: "earnings-move" | "vol-dislocation" | "catalyst-vol";
  structure: string; // code-computed, e.g. "Sell the ATM straddle"
  side: TradeSide;
  stat: string; // code-computed hard numbers (the mispricing), e.g. "Implied ±9% vs ~20% realized (n=6)"
  event: string | null; // the catalyst/date, e.g. "Q2 earnings ~in 8d" / "Investor Day 2026-09-15"
  daysToEvent: number | null;
  expiry: string | null;
  score: number; // deterministic rank
  // ── LLM narrative (added by the synthesis pass; absent if the model didn't select it) ──
  thesis?: string;
  risk?: string;
  trap?: boolean; // the edge may just be pricing a known event, not a free lunch
  conviction?: Conviction;
}

export interface TradeDeskData {
  generatedAt: string;
  weekOf: string;
  model?: string;
  pool: number; // how many candidates the LLM chose from
  ideas: TradeIdea[]; // the selected, narrated shortlist (highest conviction first)
}

export const sideLabel = (s: TradeSide): string => (s === "sell-vol" ? "Sell vol" : s === "buy-vol" ? "Buy vol" : "Buy event vol");
// Vol trades are direction-neutral, so avoid green/red (which read as bull/bear): amber = short premium,
// blue = long premium, violet = long event vol.
export const sideColor = (s: TradeSide): string => (s === "sell-vol" ? "#f59e0b" : s === "buy-vol" ? "#60a5fa" : "#a78bfa");
export const convColor = (c?: Conviction): string => (c === "high" ? "#22c55e" : c === "medium" ? "#f59e0b" : "var(--text-3)");
