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
import { factorSpreads } from "./factorSpreads";

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
  marketNeutral: boolean; // true if solved under the flatten-market-beta constraint
  neutralized: string[]; // every factor whose hedged-book beta was pinned to zero (incl. "Market")
}

/**
 * Min-variance ridge solve for the overlay over an ETF return matrix R. For each factor vector in
 * `constraints`, add the equality that the hedged book's beta to that factor is zero (KKT: augment the
 * ridge normal equations with one beta row per factor). Market-neutral is just constraints = [market];
 * factor-targeting adds Size/Value/Momentum/… rows the same way. Returns h (one notional per row of R).
 */
function solveBasket(R: number[][], pnl: number[], constraints: number[][], ridge: number): number[] | null {
  const k = R.length;
  if (!k) return null;
  const mR = R.map((r) => mean(r));
  const mP = mean(pnl);
  const Sigma = R.map((rj, j) => R.map((rk, kk) => covOf(rj, rk, mR[j], mR[kk])));
  const c = R.map((rj, j) => covOf(pnl, rj, mP, mR[j]));
  const lam = ridge * ((Sigma.reduce((a, row, i) => a + row[i], 0) / k) || 1);
  const A = Sigma.map((row, i) => row.map((v, j) => v + (i === j ? lam : 0)));

  // Each factor f with Var(f)>0 gives one equality: betaK(f)ᵀh = −betaBook(f), zeroing the hedged beta to f.
  const cons = constraints
    .filter((f) => f.length === pnl.length)
    .map((f) => {
      const mF = mean(f), vF = covOf(f, f, mF, mF);
      return vF > 0 ? { betaK: R.map((rj, j) => covOf(rj, f, mR[j], mF) / vF), betaBook: covOf(pnl, f, mP, mF) / vF } : null;
    })
    .filter((x): x is { betaK: number[]; betaBook: number } => x != null);

  if (!cons.length) return solveLinear(A, c.map((v) => -v)); // unconstrained: h* = −(Σ+λI)⁻¹ c

  // KKT block system: [A B; Bᵀ 0][h; μ] = [−c; −betaBook], B's columns = each factor's ETF-beta vector.
  const p = cons.length;
  const K: number[][] = A.map((row, i) => [...row, ...cons.map((cc) => cc.betaK[i])]);
  for (let q = 0; q < p; q++) K.push([...cons[q].betaK, ...new Array(p).fill(0)]);
  const sol = solveLinear(K, [...c.map((v) => -v), ...cons.map((cc) => -cc.betaBook)]);
  return sol ? sol.slice(0, k) : null;
}

export function optimizeHedge(
  holdings: { symbol: string; value: number }[],
  aligned: AlignedReturns,
  etfReturns: Record<string, number[]>,
  opts: { ridge?: number; maxGross?: number | null; marketNeutral?: boolean; maxLegs?: number | null; neutralizeFactors?: string[] } = {},
): HedgeOptResult | null {
  const { ridge = 0.05, maxGross = null, marketNeutral = false, maxLegs = null, neutralizeFactors = [] } = opts;
  const { dates, returns, market } = aligned;
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

  // Build the equality-constraint vectors: market (β-neutral toggle or "Market" in the list) + any chosen
  // style factors, all resolved from the SAME spreads the attribution uses. Deduped, preserving order.
  const hasMarket = !!market && market.length === nDays;
  const wanted = [...(marketNeutral ? ["Market"] : []), ...neutralizeFactors].filter((v, i, a) => a.indexOf(v) === i);
  const spreads = hasMarket ? factorSpreads(aligned.extra, market!) : null;
  const constraints: number[][] = [];
  const neutralized: string[] = [];
  for (const name of wanted) {
    const v = name === "Market" ? (hasMarket ? market! : null) : spreads?.[name] ?? null;
    if (v && v.length === nDays) { constraints.push(v); neutralized.push(name); }
  }
  const constrained = constraints.length > 0;

  let h = solveBasket(etfs.map((e) => etfReturns[e]), pnl, constraints, ridge);
  if (!h) return null;

  // Cap to the N biggest legs, then re-solve on just those ETFs for a clean, optimal small basket.
  if (maxLegs && maxLegs > 0 && etfs.filter((_e, j) => Math.abs(h![j]) > 1e-6).length > maxLegs) {
    const keep = etfs.map((e, j) => ({ e, j, w: Math.abs(h![j]) })).sort((a, b) => b.w - a.w).slice(0, maxLegs);
    const sub = solveBasket(keep.map((x) => etfReturns[x.e]), pnl, constraints, ridge);
    if (sub) { h = etfs.map(() => 0); keep.forEach((x, i) => { h![x.j] = sub[i]; }); }
  }

  let hh = h;
  // Gross cap scales the overlay down — but uniform scaling breaks the neutrality equalities, so it is
  // only applied in the unconstrained mode (ridge + max-legs already bound a constrained basket).
  const gross0 = hh.reduce((a, x) => a + Math.abs(x), 0);
  if (!constrained && maxGross && gross0 > maxGross && gross0 > 0) hh = hh.map((x) => x * (maxGross / gross0));

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
    nEtfs: etfs.length,
    marketNeutral: neutralized.includes("Market"),
    neutralized,
  };
}
