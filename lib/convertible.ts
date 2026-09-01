/**
 * CLIENT-SAFE convertible-bond pricing — the standard COMPONENT model: a convertible = a straight-bond
 * floor + an embedded equity call (right to convert par into `ratio` shares at the conversion price).
 *
 * It does three things a vol desk wants, all WITHOUT a live convertible price (which the terminal has no
 * feed for): (1) value the convert given a vol; (2) back out the implied vol the convert was ISSUED at
 * (priced at par) — the arb signal, since converts routinely price BELOW listed option vol, and that
 * cheapness is the classic long-convert / short-stock edge; (3) report the hedge ratio (delta), parity,
 * and moneyness. Simplified: flat credit spread (an estimate for unrated growth names), no issuer
 * soft/hard calls or investor puts, continuous coupon. Decision support, not a trading model.
 */

const SQRT2PI = 2.5066282746310002;
function normCdf(x: number): number {
  const t = 1 / (1 + 0.2316419 * Math.abs(x));
  const d = (Math.exp((-x * x) / 2)) / SQRT2PI;
  const p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
  return x >= 0 ? 1 - p : p;
}
function bsCall(S: number, K: number, T: number, sigma: number, r: number, q = 0): number {
  if (T <= 0 || sigma <= 0) return Math.max(0, S * Math.exp(-q * T) - K * Math.exp(-r * T));
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / v;
  return S * Math.exp(-q * T) * normCdf(d1) - K * Math.exp(-r * T) * normCdf(d1 - v);
}
function bsCallDelta(S: number, K: number, T: number, sigma: number, r: number, q = 0): number {
  if (T <= 0 || sigma <= 0) return S * Math.exp(-q * T) > K * Math.exp(-r * T) ? Math.exp(-q * T) : 0;
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / v;
  return Math.exp(-q * T) * normCdf(d1);
}
const normPdf = (x: number): number => Math.exp((-x * x) / 2) / SQRT2PI;
function bsCallGamma(S: number, K: number, T: number, sigma: number, r: number, q = 0): number {
  if (T <= 0 || sigma <= 0 || S <= 0) return 0;
  const v = sigma * Math.sqrt(T);
  const d1 = (Math.log(S / K) + (r - q + (sigma * sigma) / 2) * T) / v;
  return (Math.exp(-q * T) * normPdf(d1)) / (S * v);
}

export interface ConvertibleTerms {
  ticker: string;
  issuer?: string;
  coupon: number; // annual coupon, decimal (0.005 = 0.50% — typical for these low-cash-cost converts)
  maturityYears: number; // years to maturity from now
  par?: number; // face value, default 1000
  conversionPrice: number; // stock price at which par converts (Kc); ratio = par / Kc
  refPrice?: number | null; // stock price at PRICING (for the issue-vol back-out). If null, derived from premium.
  premium?: number | null; // conversion premium at issue, decimal (0.35 = 35% above the reference price)
  sizeMM?: number | null; // deal size, $ millions
  cappedCallCap?: number | null; // capped-call upper strike, if the issuer bought a call spread to lift the effective conversion price
}

/** Shares delivered per bond on conversion. */
export const conversionRatio = (t: ConvertibleTerms): number => (t.par ?? 1000) / t.conversionPrice;

/** The straight-bond value (investment floor): PV of par + a continuous coupon annuity at the risky
 *  rate (risk-free + credit spread). */
export function bondFloor(t: ConvertibleTerms, r: number, creditSpread: number, T: number = t.maturityYears): number {
  const par = t.par ?? 1000;
  const y = Math.max(1e-6, r + creditSpread);
  return par * Math.exp(-y * T) + t.coupon * par * ((1 - Math.exp(-y * T)) / y);
}

export interface ConvertValue {
  value: number; // theoretical convert value, per par
  bondFloor: number; // the investment floor
  callValue: number; // ratio × the embedded equity call
  parity: number; // conversion value = ratio × S, per par
  investmentPremium: number; // (value − bondFloor)/bondFloor — how far above the bond floor
  conversionPremium: number; // (value − parity)/parity — how far above conversion value
  delta: number; // ∂value/∂S in SHARES per bond — the short-stock hedge ratio
  gamma: number; // ∂delta/∂S in shares per bond per $1 move — the gamma you harvest by rehedging
  equitySensitivity: number; // delta·S / value — 0 = trades like a bond, ~1 = trades like the stock
  moneyness: "busted" | "balanced" | "in-the-money";
}

export function convertibleValue(t: ConvertibleTerms, S: number, sigma: number, r: number, creditSpread: number, q = 0, T: number = t.maturityYears): ConvertValue {
  const par = t.par ?? 1000;
  const ratio = conversionRatio(t);
  const floor = bondFloor(t, r, creditSpread, T);
  const callValue = ratio * bsCall(S, t.conversionPrice, T, sigma, r, q);
  const value = floor + callValue;
  const parity = ratio * S;
  const delta = ratio * bsCallDelta(S, t.conversionPrice, T, sigma, r, q);
  const gamma = ratio * bsCallGamma(S, t.conversionPrice, T, sigma, r, q);
  const parPct = parity / par;
  return {
    value,
    bondFloor: floor,
    callValue,
    parity,
    investmentPremium: floor > 0 ? (value - floor) / floor : 0,
    conversionPremium: parity > 0 ? (value - parity) / parity : 0,
    delta,
    gamma,
    equitySensitivity: value > 0 ? (delta * S) / value : 0,
    moneyness: parPct < 0.6 ? "busted" : parPct > 1.15 ? "in-the-money" : "balanced",
  };
}

/** The vol that makes the convert worth PAR at issue (S = the reference price) — the "issue vol", i.e.
 *  the implied vol the market paid for the embedded optionality. null if the terms can't price to par. */
export function impliedIssueVol(t: ConvertibleTerms, r: number, creditSpread: number, q = 0): number | null {
  const par = t.par ?? 1000;
  const S = t.refPrice ?? (t.premium != null ? t.conversionPrice / (1 + t.premium) : null);
  if (S == null || !(S > 0)) return null;
  const targetCall = par - bondFloor(t, r, creditSpread); // the embedded call must be worth this to price at par
  if (targetCall <= 0) return null; // bond floor already ≥ par → no equity option needed / inconsistent
  const ratio = conversionRatio(t);
  const f = (sig: number) => ratio * bsCall(S, t.conversionPrice, t.maturityYears, sig, r, q) - targetCall;
  let lo = 0.01, hi = 3;
  if (f(lo) >= 0) return lo; // even ~0 vol overshoots par (deep ITM at issue) — floor it
  if (f(hi) < 0) return null; // even 300% vol can't reach par — terms inconsistent
  for (let i = 0; i < 64; i++) { const mid = (lo + hi) / 2; if (f(mid) >= 0) hi = mid; else lo = mid; }
  return (lo + hi) / 2;
}

/** Issue vol vs the stock's listed option vol — the arb read. ratio < 1 = the convert's embedded vol was
 *  cheap vs listed options (the classic long-convert / short-stock edge). */
export function volEdge(issueVol: number, listedIV: number): { ratio: number; verdict: "cheap" | "fair" | "rich" } {
  const ratio = listedIV > 0 ? issueVol / listedIV : NaN;
  return { ratio, verdict: ratio <= 0.9 ? "cheap" : ratio >= 1.1 ? "rich" : "fair" };
}

/** A rough credit-spread estimate for an unrated issuer from its convert coupon — low-coupon converts
 *  tend to come from higher-quality names. THE MODEL'S SOFTEST INPUT: a wrong spread shifts the bond
 *  floor and thus the backed-out vol, so the cheap/rich-vs-listed READ is far more robust than the level. */
export function estimateCreditSpread(coupon: number): number {
  return Math.max(0.015, Math.min(0.09, 0.02 + Math.max(0, coupon)));
}

/** Convert-arb CARRY, annualized as a % of the convert's notional. You collect the coupon and pay — on
 *  the short-stock hedge — the borrow fee + any dividend, both scaled by how much stock you're short.
 *  `hedgeNotionalFrac` = delta·S/par (the $ of stock shorted per $1 of convert face). net < 0 means the
 *  position BLEEDS while you wait for convergence (a fat borrow on an HTB name flips it deeply negative).
 *  All rates decimal. Short-proceeds interest ≈ your funding cost, so it's left out (roughly a wash). */
export function convertCarry(coupon: number, hedgeNotionalFrac: number, borrowFee: number, dividendYield: number): { net: number; couponYield: number; borrowDrag: number; divDrag: number } {
  const h = Math.max(0, hedgeNotionalFrac);
  const borrowDrag = h * Math.max(0, borrowFee);
  const divDrag = h * Math.max(0, dividendYield);
  return { net: coupon - borrowDrag - divDrag, couponYield: coupon, borrowDrag, divDrag };
}

/** A convertible as stored/served: extracted terms + the code-computed issue vol + provenance. */
export interface ConvertibleRow {
  ticker: string;
  issuer: string;
  coupon: number;
  maturity: string | null; // ISO date
  maturityYears: number;
  conversionPrice: number;
  premium: number | null; // conversion premium at issue
  refPrice: number | null; // stock price at pricing
  sizeMM: number | null;
  cappedCallCap: number | null; // capped-call upper strike (dilution cap), if the issuer bought one
  par: number;
  creditSpread: number; // the estimate used
  issueVol: number | null; // impliedIssueVol under that estimate
  listedIV: number | null; // stock's current ATM listed IV, if resolvable (for the vol edge)
  realizedVol: number | null;
  borrowFee: number | null; // annualized stock-borrow fee, decimal (the short leg's cost); IB floor ~0.0025
  borrowAvailable: number | null; // shares available to borrow
  borrowStale: boolean; // borrow feed flagged the availability stale
  dividendYield: number | null; // the short pays this (decimal); ~0 for most convert issuers
  filedDate: string; // offering filing date
  filingUrl: string;
  form: string;
  extractedAt: string;
}
export interface ConvertiblesData {
  generatedAt: string;
  rows: ConvertibleRow[];
}
