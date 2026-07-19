/**
 * Risk-minimizing hedge overlay for the Portfolio Cockpit. Given the book's daily P&L and a menu of
 * liquid ETF return series, solve for the ETF notionals h that minimize the variance of the hedged book:
 *
 *   Var(P + Σ hₖ·rₖ) = Var(P) + 2 hᵀc + hᵀΣh   →   minimized at   h* = −(Σ + λI)⁻¹ c
 *
 * where Σ = Cov(ETF returns), c = Cov(P_book, ETF returns). Ridge λ (a fraction of the mean ETF variance)
 * tames collinearity — SPY, sector, and style ETFs overlap heavily, so the raw normal equations are
 * ill-conditioned. This is the honest, data-driven hedge (real vol before/after), vs the first-order
 * factor-ETF basket in lib/hedge.ts. Pure + fs-free → unit-tested (tests/hedgeOptimizer.test.ts). The
 * client runs it on the ETF matrix the risk route ships, with the position sizes it never uploads.
 */

import type { AlignedReturns } from "./portfolioRisk";

const TRADING_DAYS = 252;
const mean = (x: number[]): number => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);
function std(x: number[]): number {
  const n = x.length;
  if (n < 2) return 0;
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) * (v - m), 0) / (n - 1));
}
const covOf = (x: number[], y: number[], mx: number, my: number): number => {
  let s = 0;
  for (let t = 0; t < x.length; t++) s += (x[t] - mx) * (y[t] - my);
  return s / (x.length - 1);
};

/** Solve A x = b for a small dense system (Gaussian elimination, partial pivoting). null if singular. */
export function solveLinear(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let piv = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i]);
}

export interface HedgeLegOpt { etf: string; notional: number } // signed $ (negative = short)
export interface HedgeOptResult {
  legs: HedgeLegOpt[]; // sorted by |notional| desc, tiny legs dropped
  volBeforeDollar: number; // annualized $ vol of the book
  volAfterDollar: number; // annualized $ vol after applying the overlay
  volReduction: number; // 1 − after/before (0..1)
  turnoverDollar: number; // Σ |notional| of the overlay
  nEtfs: number; // ETFs in the solved menu
}

export function optimizeHedge(
  holdings: { symbol: string; value: number }[],
  aligned: AlignedReturns,
  etfReturns: Record<string, number[]>,
  opts: { ridge?: number; maxGross?: number | null } = {},
): HedgeOptResult | null {
  const { ridge = 0.05, maxGross = null } = opts;
  const { dates, returns } = aligned;
  const nDays = dates.length;
  const withSeries = holdings.filter((h) => returns[h.symbol.toUpperCase()]?.length === nDays);
  if (withSeries.length === 0 || nDays < 30) return null;

  // Book P&L series (same construction as computePortfolioRisk).
  const pnl = new Array<number>(nDays).fill(0);
  for (const h of withSeries) {
    const r = returns[h.symbol.toUpperCase()];
    for (let t = 0; t < nDays; t++) pnl[t] += h.value * r[t];
  }
  if (std(pnl) === 0) return null;

  const etfs = Object.keys(etfReturns).filter((e) => etfReturns[e]?.length === nDays);
  if (etfs.length === 0) return null;
  const R = etfs.map((e) => etfReturns[e]);
  const mR = R.map((r) => mean(r));
  const mP = mean(pnl);

  const k = etfs.length;
  const Sigma = R.map((rj, j) => R.map((rk, kk) => covOf(rj, rk, mR[j], mR[kk])));
  const c = R.map((rj, j) => covOf(pnl, rj, mP, mR[j])); // Cov(P_book, r_j)
  const diagMean = Sigma.reduce((a, row, i) => a + row[i], 0) / k || 1;
  const lam = ridge * diagMean;
  const A = Sigma.map((row, i) => row.map((v, j) => v + (i === j ? lam : 0)));
  const h = solveLinear(A, c.map((v) => -v)); // h* = −(Σ+λI)⁻¹ c
  if (!h) return null;

  let hh = h;
  const gross0 = hh.reduce((a, x) => a + Math.abs(x), 0);
  if (maxGross && gross0 > maxGross && gross0 > 0) hh = hh.map((x) => x * (maxGross / gross0)); // scale to a cap

  const hedged = pnl.map((p, t) => p + etfs.reduce((a, e, j) => a + hh[j] * etfReturns[e][t], 0));
  const volBefore = std(pnl) * Math.sqrt(TRADING_DAYS);
  const volAfter = std(hedged) * Math.sqrt(TRADING_DAYS);
  const turnover = hh.reduce((a, x) => a + Math.abs(x), 0);
  const legs = etfs
    .map((etf, j) => ({ etf, notional: hh[j] }))
    .filter((l) => Math.abs(l.notional) >= 0.005 * (turnover || 1))
    .sort((a, b) => Math.abs(b.notional) - Math.abs(a.notional));

  return {
    legs,
    volBeforeDollar: volBefore,
    volAfterDollar: volAfter,
    volReduction: volBefore > 0 ? Math.max(0, 1 - volAfter / volBefore) : 0,
    turnoverDollar: turnover,
    nEtfs: k,
  };
}
