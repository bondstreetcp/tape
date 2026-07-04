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
 * pass so a single junk OTM quote can't tilt the whole smile. T in years. */
export function fitSmile(points: SmilePoint[], T: number): SmileFit | null {
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
