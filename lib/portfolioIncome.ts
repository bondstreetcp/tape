/**
 * Portfolio Options Income — "how much can I collect writing covered calls on what I already own."
 * Joins the pasted book (LONGS only — you need the shares to cover) to the nightly covered-call
 * suggestions in putwrite.json, sizes the premium in real dollars for the position, and flags any
 * holding whose next earnings print falls before the call expires (selling a call through earnings
 * trades extra premium for gap/assignment risk). Pure + fs-free (the page ships the candidates, the
 * client reads the localStorage book and joins), so it's unit-tested. The third "my book" tool
 * alongside the Portfolio Cockpit (risk) and Portfolio Catalyst Radar (events).
 */
import type { CallSuggestion, PutWriteCandidate, TenorId } from "./putwrite";
import type { BookPosition } from "./portfolioCatalysts";

// Only the fields the covered-call income view needs — the page ships THIS slim shape (not the full
// candidate with its puts/spreads/condors) so the client payload stays small.
export type IncomeCandidate = Pick<PutWriteCandidate, "symbol" | "name" | "sector" | "price" | "nextEarnings" | "earningsEstimate" | "calls">;

export interface IncomeRow {
  symbol: string;
  name: string;
  sector: string;
  shares: number; // long shares held (net, > 0)
  price: number;
  contracts: number; // standard 100-share contracts you could write = floor(shares / 100)
  oddLot: boolean; // holds < 100 shares → no full contract (per-share yield still shown)
  call: CallSuggestion; // the covered-call suggestion for the selected tenor
  premiumDollars: number; // call.premium × 100 × contracts — the cash collected up front
  earningsBeforeExpiry: boolean; // next earnings on/before the call expiry (event risk in the window)
  nextEarnings: string | null;
  earningsEstimate: boolean;
}

export interface IncomeResult {
  rows: IncomeRow[]; // owned longs that have a call suggestion, biggest premium $ first
  totalPremium: number; // Σ premiumDollars across writable holdings
  coveredLongs: number; // distinct long names with a suggestion
  totalLongs: number; // distinct long names in the book
  uncovered: string[]; // long names with NO suggestion (outside the quality options universe)
  shortsExcluded: number; // short positions can't be covered-call'd — excluded, surfaced for honesty
}

/** Net shares per symbol from the raw book (a name may be listed twice); sign decides long/short. */
function netBySymbol(positions: BookPosition[]): Map<string, number> {
  const m = new Map<string, number>();
  for (const p of positions) {
    if (!p?.symbol || !Number.isFinite(p.shares)) continue;
    const k = p.symbol.trim().toUpperCase();
    m.set(k, (m.get(k) ?? 0) + p.shares);
  }
  for (const [k, v] of m) if (v === 0) m.delete(k);
  return m;
}

/**
 * Build the covered-call income view. `tenor` picks the suggestion set (m1 ≈30Δ/1-month is the
 * classic monthly write; m3 ≈20Δ/3-month leaves more upside room). `nowMs` injected for testability.
 */
export function buildPortfolioIncome(
  positions: BookPosition[],
  candidates: IncomeCandidate[],
  tenor: TenorId,
  opts: { nowMs?: number } = {},
): IncomeResult {
  const nowMs = opts.nowMs ?? Date.now();
  const net = netBySymbol(positions);
  const bySym = new Map(candidates.map((c) => [c.symbol.trim().toUpperCase(), c]));

  let shortsExcluded = 0;
  let totalLongs = 0;
  const rows: IncomeRow[] = [];
  const uncovered: string[] = [];
  for (const [sym, shares] of net) {
    if (shares < 0) { shortsExcluded++; continue; } // no shares to write against
    totalLongs++;
    const c = bySym.get(sym);
    const call = c?.calls?.[tenor] ?? null;
    if (!c || !call) { uncovered.push(sym); continue; }
    const contracts = Math.floor(shares / 100);
    const expMs = Date.parse(call.expiry + "T00:00:00Z");
    const eMs = c.nextEarnings ? Date.parse(c.nextEarnings) : NaN;
    rows.push({
      symbol: sym,
      name: c.name,
      sector: c.sector,
      shares,
      price: c.price,
      contracts,
      oddLot: contracts === 0,
      call,
      premiumDollars: +(call.premium * 100 * contracts).toFixed(2),
      earningsBeforeExpiry: Number.isFinite(eMs) && Number.isFinite(expMs) && eMs >= nowMs && eMs <= expMs,
      nextEarnings: c.nextEarnings,
      earningsEstimate: c.earningsEstimate,
    });
  }
  // Biggest dollar income first; per-share annualized yield breaks ties (odd lots → 0 premium $).
  rows.sort((a, b) => b.premiumDollars - a.premiumDollars || b.call.annPct - a.call.annPct || a.symbol.localeCompare(b.symbol));

  return {
    rows,
    totalPremium: +rows.reduce((s, r) => s + r.premiumDollars, 0).toFixed(2),
    coveredLongs: rows.length,
    totalLongs,
    uncovered: uncovered.sort(),
    shortsExcluded,
  };
}
