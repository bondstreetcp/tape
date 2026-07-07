/**
 * Put-Writing (cash-secured put) screener. Finds high-quality, reasonably-valued large caps
 * with elevated option premiums — names you'd be content to *own* if assigned, where the
 * market is paying you well to take that risk. The screen layers a fundamental filter
 * (large cap, ROE > 15%, P/E < 25) over an options read (a ~16-delta put ≈ 35 DTE and its
 * annualized premium), so the output is both "a stock I'd own" and "a trade worth doing."
 *
 * The heavy lifting (chain fetch, IV solve, strike selection, realized-vol rank) happens
 * offline in scripts/refresh-putwrite.ts → data/putwrite.json. This module owns the types,
 * the loader, and the Black-Scholes math (shared so a future API route could reuse it).
 *
 * Caveats baked into the UI: premiums are end-of-day last/mid (indicative, not a live fill);
 * "IV Rank" needs stored IV history so it comes online over time — the realized-vol rank is
 * the immediate elevated-vol proxy; and this is a research screen, not investment advice.
 */
import { promises as fsp } from "fs";
import path from "path";

export interface PutSuggestion {
  expiry: string; // YYYY-MM-DD
  dte: number;
  strike: number;
  delta: number; // negative, ≈ -0.16
  iv: number; // implied vol backed out of the premium (fraction)
  premium: number; // per share
  premiumSrc: "mid" | "last"; // mid(bid,ask) when the market's open, else last trade
  yieldPct: number; // premium / strike, the period return on cash secured
  annPct: number; // yieldPct annualized (× 365/dte)
  cushionPct: number; // (spot - strike) / spot — how far it can fall before you're in the money
  breakeven: number; // strike - premium
}

export interface CallSuggestion {
  expiry: string; // YYYY-MM-DD
  dte: number;
  strike: number; // ≥ spot (OTM)
  delta: number; // positive, ≈ 0.30
  iv: number; // implied vol backed out of the premium (fraction)
  premium: number; // per share
  premiumSrc: "mid" | "last";
  yieldPct: number; // premium / spot — static income return on the shares this period
  annPct: number; // static yield annualized (× 365/dte)
  ifCalledPct: number; // (premium + (strike − spot)) / spot — total return if assigned away
  ifCalledAnnPct: number; // if-called return annualized
  capPct: number; // (strike − spot) / spot — upside room before the shares are capped away
  breakeven: number; // spot − premium — downside cushion the premium buys
}

// Defined-risk credit spreads built from the same chain (16Δ short / ~8Δ long wings).
export interface BullPutSuggestion {
  expiry: string;
  dte: number;
  shortStrike: number; // sell the ~16Δ put
  longStrike: number; // buy the ~8Δ put below it (defines the risk)
  credit: number; // net premium collected, per share
  width: number; // shortStrike − longStrike
  maxLoss: number; // (width − credit) per share — the most you can lose
  ror: number; // credit / maxLoss — return on risk (fraction)
  pop: number; // ≈ 1 − |shortDelta| — prob. the short stays OTM
  breakeven: number; // shortStrike − credit
}
export interface IronCondorSuggestion {
  expiry: string;
  dte: number;
  putLong: number; putShort: number; callShort: number; callLong: number; // ~8Δ/16Δ/16Δ/8Δ
  credit: number; // total net premium per share
  width: number; // the (wider) wing width — the risk leg
  maxLoss: number; // (width − credit) per share
  ror: number; // credit / maxLoss
  pop: number; // ≈ prob. price finishes between the two short strikes
  lowBE: number; highBE: number; // breakevens: putShort − credit, callShort + credit
}

// Tenors the screen prices a put for. Two styles: the standard ~1-month / ~16-delta CSP, and a
// lower-delta, longer-dated ~3-month / ~10-delta put (further OTM ≈ 15%+, less market-beta risk).
// `z` is the standard-normal quantile N⁻¹(1 − targetDelta) used to locate the strike.
// Each tenor also carries the covered-CALL side: `callDelta` is the target call delta and `zCall`
// = N⁻¹(callDelta) (negative ⇒ OTM strike above spot). m1 sells a ~30Δ call (modest cap), m3 a
// ~20Δ call (more room). The covered call reuses the SAME expiry/chain the put screen already pulls.
// z such that N(z) = 0.84 → locates the strike of a ~16-delta (0.16) OTM put. THE single source for
// the 16Δ z-quantile — also used by refresh-putwrite's credit-spread legs; don't re-inline 0.9945.
export const Z_16DELTA = 0.9945;

export const PUT_TENORS = [
  { id: "m1", short: "~1M", note: "≈16Δ · 30–45 DTE", targetDte: 35, dteMin: 18, dteMax: 66, prefMin: 30, prefMax: 45, z: Z_16DELTA, callDelta: 0.30, zCall: -0.5244 },
  { id: "m3", short: "~3M", note: "≈10Δ · ~3-month · further OTM", targetDte: 95, dteMin: 70, dteMax: 125, prefMin: 82, prefMax: 105, z: 1.2816, callDelta: 0.20, zCall: -0.8416 },
] as const;
export type TenorId = (typeof PUT_TENORS)[number]["id"];

export interface PutWriteCandidate {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  marketCap: number;
  roe: number | null; // fraction (0.19 = 19%)
  pe: number | null; // trailing
  divYield: number | null; // fraction
  nextEarnings: string | null; // ISO datetime of the next earnings report (from the snapshot; often estimated)
  earningsEstimate: boolean; // true when Yahoo flags the date as an estimate, not yet confirmed
  rvol: number | null; // current 20-day annualized realized vol (fraction)
  rvolRank: number | null; // 0-100, where current rvol sits in its trailing-1y range
  atmIV: number | null; // ATM implied vol at the chosen expiry (fraction)
  ivRank: number | null; // 0-100 IV percentile; null until enough IV history accrues
  ivPremium: number | null; // atmIV / rvol — options pricing in more vol than realized = rich
  puts: Record<TenorId, PutSuggestion | null>; // one suggestion per tenor (m1 ≈16Δ/1mo, m3 ≈10Δ/3mo)
  calls: Record<TenorId, CallSuggestion | null>; // covered-call side, same tenors/expiries (m1 ≈30Δ, m3 ≈20Δ)
  bullPuts: Record<TenorId, BullPutSuggestion | null>; // defined-risk bull-put spread, same expiries
  condors: Record<TenorId, IronCondorSuggestion | null>; // iron condor, same expiries
}

export interface PutWriteData {
  generatedAt: string;
  source: string; // the universe the candidate pool was screened from
  rfRate: number;
  filters: { minMarketCap: number; minRoe: number; maxPe: number };
  candidates: PutWriteCandidate[];
}

// ---- Black-Scholes (European, q≈0). Good enough for screener-grade strike & delta. ----

export function normCdf(x: number): number {
  // Abramowitz & Stegun 7.1.26
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = 0.3989422804014327 * Math.exp((-x * x) / 2);
  const p = d * t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}

export function bsPut(S: number, K: number, T: number, r: number, sigma: number): number {
  if (sigma <= 0 || T <= 0) return Math.max(K * Math.exp(-r * T) - S, 0);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return K * Math.exp(-r * T) * normCdf(-d2) - S * normCdf(-d1);
}

export function putDelta(S: number, K: number, T: number, r: number, sigma: number): number {
  if (sigma <= 0 || T <= 0) return S > K ? 0 : -1;
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  return normCdf(d1) - 1; // negative
}

/** Implied vol from a put PRICE via bisection. Yahoo's per-contract iv field is unreliable
 *  (returns nonsense like 6% on a JPM put); the premium is the trustworthy input, so we solve
 *  for the vol that reproduces it. */
export function ivFromPut(S: number, K: number, T: number, r: number, price: number): number | null {
  if (price <= 0 || T <= 0) return null;
  const intrinsic = Math.max(K * Math.exp(-r * T) - S, 0);
  if (price < intrinsic - 0.02) return null; // arbitrage / stale quote
  let lo = 0.01, hi = 3;
  if (bsPut(S, K, T, r, hi) < price) return null; // off the top of the vol range
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (bsPut(S, K, T, r, mid) > price) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

// ---- Call side (covered-call screen). Mirror of the put helpers. ----

export function bsCall(S: number, K: number, T: number, r: number, sigma: number): number {
  if (sigma <= 0 || T <= 0) return Math.max(S - K * Math.exp(-r * T), 0);
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return S * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d2);
}

export function callDelta(S: number, K: number, T: number, r: number, sigma: number): number {
  if (sigma <= 0 || T <= 0) return S > K ? 1 : 0;
  const d1 = (Math.log(S / K) + (r + (sigma * sigma) / 2) * T) / (sigma * Math.sqrt(T));
  return normCdf(d1); // positive, 0…1
}

/** Implied vol from a call PRICE via bisection (vendor per-contract iv is unreliable; premium isn't). */
export function ivFromCall(S: number, K: number, T: number, r: number, price: number): number | null {
  if (price <= 0 || T <= 0) return null;
  const intrinsic = Math.max(S - K * Math.exp(-r * T), 0);
  if (price < intrinsic - 0.02) return null; // arbitrage / stale quote
  let lo = 0.01, hi = 3;
  if (bsCall(S, K, T, r, hi) < price) return null; // off the top of the vol range
  for (let i = 0; i < 64; i++) {
    const mid = (lo + hi) / 2;
    if (bsCall(S, K, T, r, mid) > price) hi = mid; else lo = mid;
  }
  return (lo + hi) / 2;
}

/** Annualized realized volatility from the last `window` daily closes (close-to-close). */
export function realizedVol(closes: number[], window = 20): number | null {
  if (closes.length < window + 1) return null;
  const s = closes.slice(-(window + 1));
  const rets: number[] = [];
  for (let i = 1; i < s.length; i++) {
    if (s[i] > 0 && s[i - 1] > 0) rets.push(Math.log(s[i] / s[i - 1]));
  }
  if (rets.length < 5) return null;
  const mean = rets.reduce((a, b) => a + b, 0) / rets.length;
  const varc = rets.reduce((a, b) => a + (b - mean) ** 2, 0) / (rets.length - 1);
  return Math.sqrt(varc * 252);
}

/** Percentile (0-100) of the current `window`-day realized vol within its trailing `lookback`
 *  days — the buildable analog of IV Rank until stored IV history catches up. */
export function realizedVolRank(closes: number[], window = 20, lookback = 252): number | null {
  if (closes.length < window + 20) return null;
  const series: number[] = [];
  const start = Math.max(window, closes.length - lookback);
  for (let i = start; i < closes.length; i++) {
    const rv = realizedVol(closes.slice(0, i + 1), window);
    if (rv != null) series.push(rv);
  }
  if (series.length < 20) return null;
  const cur = series[series.length - 1];
  return (series.filter((v) => v <= cur).length / series.length) * 100;
}

/** IV percentile (0-100): share of stored history days the ATM IV was at or below today's.
 *  Needs a reasonable run of history to mean anything. */
export function ivPercentile(history: number[], current: number, minDays = 30): number | null {
  if (!Number.isFinite(current) || history.length < minDays) return null;
  return (history.filter((v) => v <= current).length / history.length) * 100;
}

let _cache: Promise<PutWriteData | null> | null = null;

export function loadPutWrite(): Promise<PutWriteData | null> {
  if (!_cache)
    _cache = fsp
      .readFile(path.join(process.cwd(), "data", "putwrite.json"), "utf8")
      .then((s) => JSON.parse(s) as PutWriteData)
      .catch(() => null);
  return _cache;
}
