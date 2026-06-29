/**
 * Expectations / Reverse-DCF — for every name, solve the FCF growth rate the current price IMPLIES
 * (a 2-stage reverse-DCF, the same binary search DcfPanel runs per-name) and compare it to the
 * growth the business has actually delivered. Names priced for far LESS growth than they've shown =
 * cheap expectations (potential mispricing); names priced for far MORE = priced for perfection.
 * Pure compute over the snapshot — equity-basis (FCF = fcfYield × marketCap), a uniform discount
 * rate so the cross-section is comparable. No new feed, no net-debt field needed.
 */
import type { StockRow } from "./types";

const DISC = 0.09; // uniform discount rate (cross-sectional comparability; ~market cost of equity)
const TERM = 0.025; // terminal growth (≈ long-run nominal GDP)

export type ExpSort = "cheap" | "perfection";

export interface ExpectationRow {
  symbol: string;
  name: string;
  sector: string;
  marketCap: number;
  price: number;
  fcfYield: number; // FCF ÷ market cap
  impliedGrowth: number | null; // FCF growth/yr the price implies (fraction)
  histGrowth: number | null; // delivered growth (3yr revenue CAGR, fallback latest YoY)
  gap: number | null; // impliedGrowth − histGrowth (fraction); negative = cheap expectations
  upside: number | null; // DCF fair value at the delivered growth vs price (fraction)
}
export interface ExpectationsData { rows: ExpectationRow[]; coverage: number }

// PV of the 2-stage FCF stream as a MULTIPLE of starting FCF (5yr stage-1 at g + Gordon terminal),
// so we can compare it directly to the price's P/FCF multiple (= 1 / fcfYield).
function pvMultiple(g: number): number {
  let pv = 0, f = 1;
  for (let y = 1; y <= 5; y++) { f *= 1 + g; pv += f / Math.pow(1 + DISC, y); }
  const tv = (f * (1 + TERM)) / (DISC - TERM);
  return pv + tv / Math.pow(1 + DISC, 5);
}

// Reverse-DCF: solve the growth rate whose 2-stage PV multiple equals the price's P/FCF (1/fcfYield).
function solveImplied(pFcf: number): number | null {
  if (!(pFcf > 0)) return null;
  const LO = -0.25, HI = 0.6;
  if (pvMultiple(HI) < pFcf) return HI; // priced for >60% growth — cap
  if (pvMultiple(LO) > pFcf) return LO; // priced for <−25% — floor
  let lo = LO, hi = HI;
  for (let i = 0; i < 60; i++) { const mid = (lo + hi) / 2; if (pvMultiple(mid) < pFcf) lo = mid; else hi = mid; }
  return (lo + hi) / 2;
}

export function buildExpectations(stocks: StockRow[], sort: ExpSort = "cheap"): ExpectationsData {
  const rows: ExpectationRow[] = [];
  for (const s of stocks) {
    const fy = s.fund?.fcfYield;
    if (!s.price || !s.marketCap || fy == null || fy <= 0) continue; // need positive free cash flow
    if (s.etf === "XLF" || (s.marketCap || 0) < 5e8) continue; // FCF-DCF doesn't fit banks
    const impliedGrowth = solveImplied(1 / fy);
    const histGrowth = s.fund?.revCagr3y ?? s.fund?.revGrowth ?? null;
    const gRef = histGrowth != null ? Math.max(-0.05, Math.min(0.25, histGrowth)) : null; // sane cap for the fair-value calc
    rows.push({
      symbol: s.symbol,
      name: s.name,
      sector: s.sector,
      marketCap: s.marketCap,
      price: s.price,
      fcfYield: fy,
      impliedGrowth,
      histGrowth,
      gap: impliedGrowth != null && histGrowth != null ? impliedGrowth - histGrowth : null,
      upside: gRef != null ? fy * pvMultiple(gRef) - 1 : null,
    });
  }
  if (sort === "perfection") rows.sort((a, b) => (b.impliedGrowth ?? -9) - (a.impliedGrowth ?? -9)); // most demanded growth first
  else rows.sort((a, b) => (a.gap ?? 9) - (b.gap ?? 9)); // cheapest expectations (most negative gap) first
  return { rows, coverage: rows.length };
}
