/**
 * Implied-vol SURFACE math (client-safe, no I/O). Per expiry we fit a smooth "fair" smile and read off
 * each listed strike's rich/cheap RESIDUAL — the actual per-strike pricing signal.
 *
 * The fair smile is a WEIGHTED least-squares fit of TOTAL VARIANCE  w = σ²·T  as a quadratic in
 * log-moneyness  k = ln(K/F):   w(k) = c0 + c1·k + c2·k².  It is closed-form (3×3 normal equations), so it
 * never fails to converge on the sparse / noisy OTM quotes Yahoo returns, and it captures the three things
 * that matter — level (c0), skew (c1), curvature/smile (c2).  σ(k) = √(w(k)/T).  The per-strike residual
 * (listed IV − fitted IV) is the rich/cheap read. (Full arb-free SVI is a later upgrade; on LISTED strikes
 * inside the fitted band the quadratic is more than adequate and far more stable than a 5-param nonlinear
 * fit on retail chain data.)
 */

export interface SmilePoint {
  strike: number;
  moneyness: number; // K/F − 1 (for display)
  k: number; // ln(K/F)
  iv: number; // solved implied vol (decimal)
  weight: number; // fit weight (liquidity)
}

export interface FittedStrike {
  strike: number;
  moneyness: number;
  observedIV: number;
  fittedIV: number;
  residual: number; // observed − fitted, IV points (decimal); >0 = rich
}

export interface SmileFit {
  c0: number;
  c1: number;
  c2: number;
  T: number;
  atmVol: number | null; // fitted σ at k=0
  skewPer10: number | null; // Δσ (vol pts, decimal) per +10% strike at ATM — a readable skew number (neg = downside richer)
  rmse: number; // fit RMSE, IV points (decimal)
  n: number;
  strikes: FittedStrike[];
  ivAt: (k: number) => number; // fitted σ at any log-moneyness (fills a smooth grid) — NOT serializable
}

// Solve a 3×3 linear system by Gaussian elimination with partial pivoting. Returns null if ~singular.
function solve3(A: number[][], b: number[]): [number, number, number] | null {
  const M = [
    [A[0][0], A[0][1], A[0][2], b[0]],
    [A[1][0], A[1][1], A[1][2], b[1]],
    [A[2][0], A[2][1], A[2][2], b[2]],
  ];
  for (let col = 0; col < 3; col++) {
    let piv = col;
    for (let r = col + 1; r < 3; r++) if (Math.abs(M[r][col]) > Math.abs(M[piv][col])) piv = r;
    if (Math.abs(M[piv][col]) < 1e-12) return null;
    [M[col], M[piv]] = [M[piv], M[col]];
    for (let r = 0; r < 3; r++) {
      if (r === col) continue;
      const f = M[r][col] / M[col][col];
      for (let c = col; c < 4; c++) M[r][c] -= f * M[col][c];
    }
  }
  return [M[0][3] / M[0][0], M[1][3] / M[1][1], M[2][3] / M[2][2]];
}

/** Weighted quadratic-in-log-moneyness fit of total variance for one expiry, with one Huber reweight
 * pass so a single junk OTM quote can't tilt the whole smile. T in years. The robust fallback for the
 * public fitSmile() when SVI degenerates; also fine on its own for interpolation inside the strike band. */
export function fitQuad(points: SmilePoint[], T: number): SmileFit | null {
  const base = points.filter((p) => p.iv > 0 && p.weight > 0 && Number.isFinite(p.k));
  if (base.length < 3 || T <= 0) return null;
  const fitOnce = (rows: { k: number; iv: number; w: number }[]): [number, number, number] | null => {
    const A = [
      [0, 0, 0],
      [0, 0, 0],
      [0, 0, 0],
    ];
    const b = [0, 0, 0];
    for (const p of rows) {
      const w = p.w,
        k = p.k,
        y = p.iv * p.iv * T,
        X = [1, k, k * k];
      for (let i = 0; i < 3; i++) {
        b[i] += w * X[i] * y;
        for (let j = 0; j < 3; j++) A[i][j] += w * X[i] * X[j];
      }
    }
    return solve3(A, b);
  };
  const varAt = (c: [number, number, number], k: number) => c[0] + c[1] * k + c[2] * k * k;
  const sig = (c: [number, number, number], k: number) => {
    const w = varAt(c, k);
    return w > 0 ? Math.sqrt(w / T) : 0;
  };
  let rows = base.map((p) => ({ k: p.k, iv: p.iv, w: p.weight }));
  let c = fitOnce(rows);
  if (!c) return null;
  // robust pass: down-weight points more than 2·RMSE off the first fit (Huber), then refit once.
  {
    let se = 0,
      sw = 0;
    for (const p of rows) {
      const d = sig(c, p.k) - p.iv;
      se += p.w * d * d;
      sw += p.w;
    }
    const rmse0 = sw > 0 ? Math.sqrt(se / sw) : 0;
    if (rmse0 > 1e-6) {
      rows = base.map((p) => {
        const r = Math.abs(sig(c!, p.k) - p.iv);
        const huber = r > 2 * rmse0 ? (2 * rmse0) / r : 1;
        return { k: p.k, iv: p.iv, w: p.weight * huber };
      });
      const c2 = fitOnce(rows);
      if (c2) c = c2;
    }
  }
  const [c0, c1, c2] = c;
  const ivAt = (k: number) => sig(c!, k);
  // residuals + RMSE reported against the FINAL fit over the ORIGINAL (un-downweighted) points.
  let se = 0,
    sw = 0;
  for (const p of base) {
    const d = ivAt(p.k) - p.iv;
    se += p.weight * d * d;
    sw += p.weight;
  }
  const rmse = sw > 0 ? Math.sqrt(se / sw) : 0;
  const atm = ivAt(0);
  const atmVol = atm > 0 ? atm : null;
  // dσ/dk at 0 = c1 / (2·T·σ_atm); scaled to a "per +10% strike" step (Δk = ln 1.1).
  const skewPer10 = atmVol ? (c1 / (2 * T * atmVol)) * Math.log(1.1) : null;
  const strikes: FittedStrike[] = base.map((p) => {
    const f = ivAt(p.k);
    return { strike: p.strike, moneyness: p.moneyness, observedIV: p.iv, fittedIV: f, residual: p.iv - f };
  });
  return { c0, c1, c2, T, atmVol, skewPer10, rmse, n: base.length, strikes, ivAt };
}

// ---- SVI (Gatheral RAW parametrization) ----------------------------------------------------------
// Total-variance slice  w(k) = a + b·( ρ·(k−m) + √((k−m)² + σ²) ).  Unlike the quadratic, its wings are
// LINEAR in k (the correct asymptotic behaviour), so EXTRAPOLATION beyond the quoted strikes is sane and
// the slice is arb-aware. Fitted with Zeliade's QUASI-EXPLICIT method: for a FIXED (m, σ) the slice is
// LINEAR in (a, d = b·σ·ρ, c = b·σ) — w = a + d·y + c·√(y²+1), y = (k−m)/σ — so the inner fit is a 3×3
// weighted least-squares, clamped to the no-arb feasible box (b≥0, |ρ|≤1, wing slopes ≤ 2). The outer
// (m, σ) is a coarse grid search. See fitSmile() for the SVI-preferred-with-quadratic-fallback dispatcher.

export interface SviParams { a: number; b: number; rho: number; m: number; sig: number }
const sviW = (p: SviParams, k: number): number => {
  const km = k - p.m;
  return p.a + p.b * (p.rho * km + Math.sqrt(km * km + p.sig * p.sig));
};

// Inner solve for fixed (m, σ): weighted LSQ of w = a + d·y + c·z, then clamp to the feasible set.
function sviInner(rows: { k: number; w: number; wt: number }[], m: number, sig: number): SviParams | null {
  const A = [
    [0, 0, 0],
    [0, 0, 0],
    [0, 0, 0],
  ];
  const B = [0, 0, 0];
  for (const r of rows) {
    const y = (r.k - m) / sig,
      z = Math.sqrt(y * y + 1),
      X = [1, y, z];
    for (let i = 0; i < 3; i++) {
      B[i] += r.wt * X[i] * r.w;
      for (let j = 0; j < 3; j++) A[i][j] += r.wt * X[i] * X[j];
    }
  }
  const sol = solve3(A, B);
  if (!sol) return null;
  let [a, d, c] = sol;
  const s4 = 4 * sig;
  c = Math.max(0, Math.min(c, s4)); // b ≥ 0, wing-slope bound
  const dlim = Math.min(c, s4 - c); // |ρ| ≤ 1 and the far-wing no-arb bound
  d = Math.max(-dlim, Math.min(dlim, d));
  a = Math.max(0, a); // total variance floor ≥ 0
  return { a, b: c / sig, rho: c > 1e-9 ? d / c : 0, m, sig };
}

/** Fit a single expiry's smile with raw SVI (Zeliade quasi-explicit). T in years. */
export function fitSVI(points: SmilePoint[], T: number): SmileFit | null {
  const src = points.filter((p) => p.iv > 0 && p.weight > 0 && Number.isFinite(p.k));
  if (src.length < 4 || T <= 0) return null; // SVI needs a few points to pin 5 params
  const rows = src.map((p) => ({ k: p.k, w: p.iv * p.iv * T, wt: p.weight }));
  const ks = rows.map((r) => r.k),
    kmin = Math.min(...ks),
    kmax = Math.max(...ks);
  const wRmse = (p: SviParams) => {
    let se = 0,
      sw = 0;
    for (const r of rows) {
      const e = sviW(p, r.k) - r.w;
      se += r.wt * e * e;
      sw += r.wt;
    }
    return sw > 0 ? Math.sqrt(se / sw) : Infinity;
  };
  let best: SviParams | null = null,
    bestErr = Infinity;
  for (let i = 0; i < 9; i++) {
    const m = kmin + (kmax - kmin) * (i / 8);
    for (let j = 0; j < 8; j++) {
      const sig = 0.02 * Math.pow(1.8, j); // ~0.02 … ~1.2
      const p = sviInner(rows, m, sig);
      if (!p) continue;
      const e = wRmse(p);
      if (e < bestErr) {
        bestErr = e;
        best = p;
      }
    }
  }
  if (!best) return null;
  const p = best;
  const ivAt = (k: number) => {
    const w = sviW(p, k);
    return w > 0 ? Math.sqrt(w / T) : 0;
  };
  let se = 0,
    sw = 0;
  for (const q of src) {
    const dd = ivAt(q.k) - q.iv;
    se += q.weight * dd * dd;
    sw += q.weight;
  }
  const rmse = sw > 0 ? Math.sqrt(se / sw) : 0;
  const atm = ivAt(0),
    atmVol = atm > 0 ? atm : null;
  // dσ/dk at 0 = w'(0) / (2·T·σ_atm); w'(k) = b(ρ + (k−m)/√((k−m)²+σ²)).
  const km0 = -p.m,
    wp0 = p.b * (p.rho + km0 / Math.sqrt(km0 * km0 + p.sig * p.sig));
  const skewPer10 = atmVol ? (wp0 / (2 * T * atmVol)) * Math.log(1.1) : null;
  const strikes: FittedStrike[] = src.map((q) => {
    const f = ivAt(q.k);
    return { strike: q.strike, moneyness: q.moneyness, observedIV: q.iv, fittedIV: f, residual: q.iv - f };
  });
  // c0/c1/c2 carry the SVI (a, b, ρ) here — consumers only use ivAt + the derived metrics.
  return { c0: p.a, c1: p.b, c2: p.rho, T, atmVol, skewPer10, rmse, n: src.length, strikes, ivAt };
}

/** Public smile fit: prefer arb-aware SVI (linear wings → sane extrapolation) but fall back to the robust
 * quadratic when SVI is unavailable or fits materially worse (a degenerate calibration on sparse quotes). */
export function fitSmile(points: SmilePoint[], T: number): SmileFit | null {
  const svi = fitSVI(points, T);
  const quad = fitQuad(points, T);
  if (!svi) return quad;
  if (!quad) return svi;
  return svi.rmse <= quad.rmse * 1.15 ? svi : quad; // SVI wins unless >15% worse than the quadratic
}
