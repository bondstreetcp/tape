/**
 * Risk-neutral density (Breeden–Litzenberger). Given a fitted vol smile σ(k), k = ln(K/F), the market-
 * implied probability density of the underlying at expiry is
 *
 *     f(K) = e^{rT} · ∂²C/∂K²
 *
 * where C(K) is the (model) call price at strike K. We price a dense strike grid off the smile, take a
 * numerical second difference, clip tiny negative noise, and renormalize to a proper density — then read
 * off the implied percentiles, P(up), and the distribution's skewness. Pure + client-safe (no I/O).
 *
 * This is what the options market is REALLY saying: not one number but a whole distribution — where it
 * prices fat tails, how asymmetric it is, the odds of finishing above/below a level. Into an earnings
 * print the front-expiry density often goes bimodal / fat-tailed; that's the event being priced.
 *
 * Caveat: only the strike band with live quotes is anchored — the tails are the smile MODEL's extrapolation
 * (arb-free SVI has linear wings, so it's sane, but still a model). Treat the far tails as indicative.
 */
import { bsPrice } from "./blackScholes";

export interface RndPoint {
  price: number;
  density: number;
}
export interface Rnd {
  points: RndPoint[]; // price grid + normalized density (∫ = 1)
  spot: number;
  T: number;
  forward: number; // S·e^{rT} — the density mean should land here (a built-in sanity check)
  mean: number;
  p05: number;
  p16: number;
  p50: number;
  p84: number;
  p95: number;
  pUp: number; // P(S_T > spot)
  skew: number; // distribution skewness (>0 = right tail heavier; <0 = downside tail heavier)
}

export function riskNeutralDensity(
  ivAt: (k: number) => number,
  S: number,
  T: number,
  r = 0.04,
  N = 121,
  span = 3.5,
): Rnd | null {
  if (!(S > 0) || !(T > 0) || N < 5) return null;
  const atm = ivAt(0);
  if (!(atm > 0)) return null;
  const sd = atm * Math.sqrt(T); // ~1σ log-move
  const Klo = S * Math.exp(-span * sd);
  const Khi = S * Math.exp(span * sd);
  const dK = (Khi - Klo) / (N - 1);
  if (!(dK > 0)) return null;

  const K = new Array<number>(N);
  const C = new Array<number>(N);
  for (let i = 0; i < N; i++) {
    const Ki = Klo + i * dK;
    let sig = ivAt(Math.log(Ki / S));
    if (!(sig > 0)) sig = atm; // guard a degenerate wing
    K[i] = Ki;
    C[i] = bsPrice("call", S, Ki, T, sig, r);
  }

  const disc = Math.exp(r * T);
  const f = new Array<number>(N).fill(0);
  for (let i = 1; i < N - 1; i++) {
    const d2 = (C[i - 1] - 2 * C[i] + C[i + 1]) / (dK * dK);
    f[i] = Math.max(0, disc * d2); // clip numerical negatives
  }
  // normalize to a proper density (trapezoid)
  let area = 0;
  for (let i = 0; i < N - 1; i++) area += 0.5 * (f[i] + f[i + 1]) * dK;
  if (!(area > 0)) return null;
  for (let i = 0; i < N; i++) f[i] /= area;

  // cumulative distribution (trapezoid)
  const cdf = new Array<number>(N).fill(0);
  for (let i = 1; i < N; i++) cdf[i] = cdf[i - 1] + 0.5 * (f[i - 1] + f[i]) * dK;

  const pctl = (q: number): number => {
    if (q <= 0) return K[0];
    if (q >= 1) return K[N - 1];
    for (let i = 1; i < N; i++) {
      if (cdf[i] >= q) {
        const t = (q - cdf[i - 1]) / Math.max(1e-12, cdf[i] - cdf[i - 1]);
        return K[i - 1] + t * (K[i] - K[i - 1]);
      }
    }
    return K[N - 1];
  };
  const cdfAt = (x: number): number => {
    if (x <= K[0]) return 0;
    if (x >= K[N - 1]) return 1;
    for (let i = 1; i < N; i++) {
      if (K[i] >= x) {
        const t = (x - K[i - 1]) / Math.max(1e-12, K[i] - K[i - 1]);
        return cdf[i - 1] + t * (cdf[i] - cdf[i - 1]);
      }
    }
    return 1;
  };

  // moments
  let mean = 0;
  for (let i = 0; i < N; i++) mean += K[i] * f[i] * dK;
  let varr = 0;
  for (let i = 0; i < N; i++) varr += (K[i] - mean) ** 2 * f[i] * dK;
  const sdev = Math.sqrt(Math.max(0, varr));
  let skew = 0;
  if (sdev > 0) for (let i = 0; i < N; i++) skew += ((K[i] - mean) / sdev) ** 3 * f[i] * dK;

  return {
    points: K.map((p, i) => ({ price: p, density: f[i] })),
    spot: S,
    T,
    forward: S * disc,
    mean,
    p05: pctl(0.05),
    p16: pctl(0.16),
    p50: pctl(0.5),
    p84: pctl(0.84),
    p95: pctl(0.95),
    pUp: 1 - cdfAt(S),
    skew,
  };
}
