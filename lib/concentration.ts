/**
 * Portfolio concentration / effective number of bets for the cockpit — the Venn/Omega-Point "you hold N
 * names but only M independent bets" read. Works on the EXPOSURE-WEIGHTED covariance of the held names'
 * returns, so it respects both correlation AND position sizing (a tiny position can't inflate the count).
 *
 * independentBets = trace(S)² / ‖S‖²_F. For eigenvalues λ of S this is (Σλ)²/Σλ² (the participation
 * ratio) — but trace(S²)=ΣᵢⱼSᵢⱼ² for symmetric S, so no eigensolver is needed for the headline number.
 * Bounds: 1 ≤ independentBets ≤ (# names). Pure + fs-free → unit-tested (tests/concentration.test.ts).
 */

import type { AlignedReturns } from "./portfolioRisk";

export interface Concentration {
  names: number; // held names with return history
  independentBets: number; // effective # independent bets (exposure-weighted PCA participation ratio)
  topPcShare: number; // largest principal component's share of book variance (0..1) — the dominant common move
  effectiveNamesBySize: number; // 1/Σw² over gross weights — sizing-only concentration (ignores correlation)
}

// Largest eigenvalue of a symmetric PSD matrix via power iteration on ‖Sv‖ (converges to λ₁). Asymmetric
// seed avoids the measure-zero case where a uniform start is orthogonal to the top eigenvector.
function topEigenvalue(S: number[][], iters = 200): number {
  const n = S.length;
  let v = Array.from({ length: n }, (_, i) => 1 + (i % 3) * 0.1);
  let norm = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  v = v.map((x) => x / norm);
  let lambda = 0;
  for (let k = 0; k < iters; k++) {
    const Sv = S.map((row) => row.reduce((a, x, j) => a + x * v[j], 0));
    norm = Math.sqrt(Sv.reduce((a, x) => a + x * x, 0));
    if (norm < 1e-30) return 0;
    v = Sv.map((x) => x / norm);
    lambda = norm; // PSD ⇒ ‖Sv‖ → λ₁
  }
  return lambda;
}

export function concentration(holdings: { symbol: string; value: number }[], aligned: AlignedReturns): Concentration | null {
  const { returns, dates } = aligned;
  const n = dates.length;
  const held = holdings.filter((h) => returns[h.symbol.toUpperCase()]?.length === n);
  const m = held.length;
  if (m < 2 || n < 20) return null;
  const gross = held.reduce((a, h) => a + Math.abs(h.value), 0) || 1;

  // Exposure-weighted return contributions xᵢ(t) = (valueᵢ/gross)·rᵢ(t), then their covariance S.
  const X = held.map((h) => {
    const r = returns[h.symbol.toUpperCase()];
    const w = h.value / gross;
    return r.map((x) => w * x);
  });
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
  const mX = X.map(mean);
  const S = X.map((xi, i) =>
    X.map((xj, j) => {
      let s = 0;
      for (let t = 0; t < n; t++) s += (xi[t] - mX[i]) * (xj[t] - mX[j]);
      return s / (n - 1);
    }),
  );
  const trace = S.reduce((a, row, i) => a + row[i], 0);
  let fro = 0;
  for (let i = 0; i < m; i++) for (let j = 0; j < m; j++) fro += S[i][j] * S[i][j];
  if (trace <= 0 || fro <= 0) return null;

  const independentBets = (trace * trace) / fro;
  const topPcShare = Math.max(0, Math.min(1, topEigenvalue(S) / trace));
  const effectiveNamesBySize = 1 / held.reduce((a, h) => { const w = Math.abs(h.value) / gross; return a + w * w; }, 0);
  return { names: m, independentBets, topPcShare, effectiveNamesBySize };
}
