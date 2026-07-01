/**
 * Client-safe Black-Scholes — the shared browser-side option pricer. lib/putwrite.ts has a server
 * copy but imports fs (offline screeners); OptionsStrategy.tsx has an unexported local copy. This is
 * the importable, fs-free version for interactive tools (the earnings IV-crush scenario matrix).
 *
 * Conventions: T in YEARS, sigma a decimal annualized vol (0.35 = 35%), r a decimal rate (default 4%).
 * At/after expiry (T<=0) or zero vol, prices collapse to intrinsic.
 */

// Standard normal CDF — Abramowitz & Stegun 7.1.26.
export function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

// European call/put price. r defaults to 4% (matches the app's other pricers).
export function bsPrice(kind: "call" | "put", S: number, K: number, T: number, sigma: number, r = 0.04): number {
  if (T <= 0 || sigma <= 0) return kind === "call" ? Math.max(0, S - K) : Math.max(0, K - S);
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / v;
  const d2 = d1 - v;
  return kind === "call" ? S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2) : K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

// Straddle (ATM call + put at the same strike) price.
export function straddlePrice(S: number, K: number, T: number, sigma: number, r = 0.04): number {
  return bsPrice("call", S, K, T, sigma, r) + bsPrice("put", S, K, T, sigma, r);
}

// Implied vol backed OUT of a market price by bisection. The app treats vendor iv as junk and solves
// IV from the premium instead — this anchors the scenario tool so "no change" reprices to exactly the
// premium paid, and the crush/move deltas are clean. Returns null if the price is un-invertible.
export function ivFromPrice(kind: "call" | "put", S: number, K: number, T: number, price: number, r = 0.04): number | null {
  if (!(price > 0) || T <= 0 || S <= 0 || K <= 0) return null;
  const intrinsic = kind === "call" ? Math.max(0, S - K * Math.exp(-r * T)) : Math.max(0, K * Math.exp(-r * T) - S);
  if (price <= intrinsic + 1e-6) return 1e-4; // no time value → essentially zero vol
  let lo = 1e-4, hi = 5; // 0.01% … 500% annualized
  if (bsPrice(kind, S, K, T, hi, r) < price) return hi; // price implies vol beyond our ceiling
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (bsPrice(kind, S, K, T, mid, r) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}

// Implied vol from a STRADDLE price (one sigma for both legs) — for the long-straddle scenario.
export function straddleIvFromPrice(S: number, K: number, T: number, price: number, r = 0.04): number | null {
  if (!(price > 0) || T <= 0 || S <= 0 || K <= 0) return null;
  const intrinsic = Math.max(0, S - K * Math.exp(-r * T)) + Math.max(0, K * Math.exp(-r * T) - S); // one leg is ITM
  if (price <= intrinsic + 1e-6) return 1e-4; // no time value → essentially zero vol
  let lo = 1e-4, hi = 5;
  if (straddlePrice(S, K, T, hi, r) < price) return hi;
  for (let i = 0; i < 100; i++) {
    const mid = (lo + hi) / 2;
    if (straddlePrice(S, K, T, mid, r) > price) hi = mid;
    else lo = mid;
  }
  return (lo + hi) / 2;
}
