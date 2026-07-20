/**
 * Portfolio risk from the holdings' OWN return history — predicted volatility, historical-simulation
 * VaR / Expected Shortfall, per-holding risk contribution, and a diversification read. This is the
 * Omega-Point-style "how much can this book actually swing" number, from free data.
 *
 * Split of labour (privacy): the /api/portfolio/risk route aligns the stored per-name series into a
 * returns matrix (pure market data) and ships it to the client; computePortfolioRisk then combines it
 * with the position sizes the client holds locally and never uploads. Pure + fs-free →
 * unit-tested (tests/portfolioRisk.test.ts). Doctrine: code computes the stat, no LLM.
 */

import { bucketByDay, correlation, type Daily } from "./pairs";
import { solveLinear } from "./hedgeOptimizer";
import { factorSpreads as buildEtfFactors } from "./factorSpreads";

const TRADING_DAYS = 252;
const mean = (x: number[]): number => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);
function std(x: number[]): number {
  const n = x.length;
  if (n < 2) return 0;
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) * (v - m), 0) / (n - 1));
}

export interface AlignedReturns {
  dates: number[]; // common day timestamps aligned to each return vector (ascending; length = nDays)
  returns: Record<string, number[]>; // SYMBOL(upper) -> simple daily returns on `dates`
  market?: number[]; // market (^GSPC) simple daily returns on `dates` — enables the systematic split
  extra?: Record<string, number[]>; // ETF menu returns on `dates` — for the hedge optimizer
}

const intersectDays = (acc: Set<number> | null, days: Set<number>): Set<number> => {
  if (acc == null) return days;
  const next = new Set<number>();
  for (const d of days) if (acc.has(d)) next.add(d);
  return next;
};
const meanOf = (x: number[]): number => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);
const covAbout = (x: number[], y: number[], mx: number, my: number): number => {
  let s = 0;
  for (let t = 0; t < x.length; t++) s += (x[t] - mx) * (y[t] - my);
  return s / (x.length - 1);
};

/**
 * Decompose Var(P&L) across factors: ridge OLS of the book's P&L on the factor spreads, then each factor's
 * share = bₖ·Cov(Fₖ,P)/Var(P) (sums to R²); Specific = 1 − R². Shares can be negative (a diversifying tilt).
 */
function factorDecomp(pnl: number[], factors: Record<string, number[]>): { factor: string; share: number }[] | null {
  const names = Object.keys(factors);
  const k = names.length;
  const mP = meanOf(pnl);
  const varP = covAbout(pnl, pnl, mP, mP);
  if (!k || varP <= 0) return null;
  const F = names.map((f) => factors[f]);
  const mF = F.map(meanOf);
  const FtF = F.map((fi, i) => F.map((fj, j) => covAbout(fi, fj, mF[i], mF[j])));
  const Fty = F.map((fi, i) => covAbout(pnl, fi, mP, mF[i]));
  const lam = 0.02 * ((FtF.reduce((a, row, i) => a + row[i], 0) / k) || 1);
  const A = FtF.map((row, i) => row.map((v, j) => v + (i === j ? lam : 0)));
  const b = solveLinear(A, Fty);
  if (!b) return null;
  const contrib = names.map((f, i) => ({ factor: f, share: (b[i] * Fty[i]) / varP }));
  return [...contrib, { factor: "Specific", share: 1 - contrib.reduce((a, c) => a + c.share, 0) }];
}

// Simple daily returns of a price map over `level` dates; null if any date is missing (keeps vectors aligned).
const returnsOn = (m: Map<number, number>, level: number[]): number[] | null => {
  const r: number[] = [];
  for (let i = 1; i < level.length; i++) {
    const p0 = m.get(level[i - 1]), p1 = m.get(level[i]);
    if (p0 == null || p1 == null || p0 <= 0) return null;
    r.push(p1 / p0 - 1);
  }
  return r;
};

/**
 * Align many daily [ts,price] series onto their SHARED trading days (last `lookback`) and return each
 * name's simple daily returns on that common axis. Day-buckets first (stored series carry intraday ts),
 * then intersects — every return vector is then the same length + same dates, which the joint-matrix
 * historical-sim VaR and risk-contribution math require. A name with no shared history is omitted.
 */
export function alignDailyReturns(
  seriesBySymbol: Record<string, Daily>,
  lookback = TRADING_DAYS,
  market?: Daily,
  extra?: Record<string, Daily>,
): AlignedReturns {
  const syms = Object.keys(seriesBySymbol);
  const priceMaps: Record<string, Map<number, number>> = {};
  let common: Set<number> | null = null;
  for (const s of syms) {
    const bucket = bucketByDay(seriesBySymbol[s] || []);
    priceMaps[s] = new Map<number, number>(bucket);
    // a name with <2 points can't form a return — don't let it constrain the shared axis
    if (bucket.length >= 2) common = intersectDays(common, new Set<number>(bucket.map(([t]) => t)));
  }
  let level = common ? Array.from(common).sort((a, b) => a - b) : [];
  if (level.length > lookback + 1) level = level.slice(level.length - (lookback + 1));

  const returns: Record<string, number[]> = {};
  if (level.length >= 2) {
    for (const s of syms) {
      const r = priceMaps[s].size >= 2 ? returnsOn(priceMaps[s], level) : null;
      if (r && r.length) returns[s.toUpperCase()] = r;
    }
  }
  // The market and the ETF menu align to the HOLDINGS' axis (dropped if they don't cover it), so a
  // glitchy or short series never shrinks the window for everyone.
  const alignOne = (ser: Daily): number[] | null => {
    if (level.length < 2) return null;
    const b = bucketByDay(ser || []);
    return b.length >= 2 ? returnsOn(new Map<number, number>(b), level) : null;
  };
  const marketRet = market ? alignOne(market) : null;
  const extraRet: Record<string, number[]> = {};
  if (extra) for (const [e, ser] of Object.entries(extra)) {
    const r = alignOne(ser);
    if (r && r.length) extraRet[e.toUpperCase()] = r;
  }
  return {
    dates: level.slice(1),
    returns,
    ...(marketRet ? { market: marketRet } : {}),
    ...(Object.keys(extraRet).length ? { extra: extraRet } : {}),
  };
}

export interface RiskContribution {
  symbol: string;
  pctRisk: number; // value_i·Cov(ret_i, P)/Var(P) — fraction of variance; Σ ≈ 1 (negative = a diversifier)
}

export interface PortfolioRisk {
  nDays: number; // observations in the shared window
  coverage: number; // |value| with usable series / total |value|
  volDailyDollar: number;
  volAnnDollar: number; // daily × √252
  volAnnPct: number | null; // annualized $ vol / base
  baseIsAum: boolean; // true = % is of AUM, false = of gross
  factorShare: number | null; // 0..1 — share of variance from the market (R² of P&L on ^GSPC); null if no market series
  volFactorDollar: number | null; // systematic (market) annualized $ vol
  volSpecificDollar: number | null; // stock-specific (idiosyncratic) annualized $ vol
  factorBreakdown: { factor: string; share: number }[] | null; // variance share per ETF-proxy factor + Specific; Σ ≈ 1
  var95Dollar: number; // 1-day 95% historical-sim VaR, as a POSITIVE loss
  var99Dollar: number;
  es95Dollar: number; // expected shortfall (avg of the worst 5% of days), positive loss
  worstDayDollar: number; // signed (≤ 0) worst single day in the window
  worstDayDate: number | null;
  undiversifiedVolDailyDollar: number; // Σ |value_i|·σ_i — if the names moved in lockstep
  diversificationBenefit: number; // 1 − vol/undiversified (0..1)
  contributions: RiskContribution[]; // sorted by |pctRisk| desc
}

/**
 * Combine the aligned return matrix with the book's position sizes into risk metrics. Historical
 * simulation: apply each of the last `nDays` joint return vectors to the CURRENT book (P(t) = Σ value_i·
 * ret_i(t)) and read the empirical distribution. Returns null if too few names have series or the window
 * is too short to be meaningful.
 */
export function computePortfolioRisk(
  holdings: { symbol: string; value: number }[],
  aligned: AlignedReturns,
  opts: { aum?: number | null } = {},
): PortfolioRisk | null {
  const { dates, returns } = aligned;
  const nDays = dates.length;
  const withSeries = holdings.filter((h) => returns[h.symbol.toUpperCase()]?.length === nDays);
  if (withSeries.length === 0 || nDays < 20) return null;

  const totalGross = holdings.reduce((a, h) => a + Math.abs(h.value), 0) || 1;
  const coverage = withSeries.reduce((a, h) => a + Math.abs(h.value), 0) / totalGross;

  // Joint daily P&L$: P(t) = Σ value_i · ret_i(t).
  const pnl = new Array(nDays).fill(0);
  for (const h of withSeries) {
    const r = returns[h.symbol.toUpperCase()];
    for (let t = 0; t < nDays; t++) pnl[t] += h.value * r[t];
  }
  const volDaily = std(pnl);
  const varP = volDaily * volDaily;

  // Historical-sim VaR/ES from the empirical P&L distribution.
  const sorted = [...pnl].sort((a, b) => a - b);
  const at = (p: number) => sorted[Math.max(0, Math.min(sorted.length - 1, Math.floor(p * sorted.length)))];
  const var95 = -at(0.05), var99 = -at(0.01);
  const tail = sorted.slice(0, Math.max(1, Math.floor(0.05 * sorted.length)));
  const es95 = -mean(tail);
  let worst = 0, worstIdx = -1;
  for (let t = 0; t < nDays; t++) if (pnl[t] < worst) { worst = pnl[t]; worstIdx = t; }

  // Undiversified daily vol = Σ |value_i|·σ_i (perfect-correlation upper bound).
  let undiv = 0;
  for (const h of withSeries) undiv += Math.abs(h.value) * std(returns[h.symbol.toUpperCase()]);
  const diversificationBenefit = undiv > 0 ? Math.max(0, 1 - volDaily / undiv) : 0;

  // Risk contribution: value_i·Cov(ret_i, P)/Var(P). Σ = 1 exactly (Σ value_i·ret_i = P).
  const mP = mean(pnl);
  const contributions: RiskContribution[] = withSeries
    .map((h) => {
      const r = returns[h.symbol.toUpperCase()];
      const mR = mean(r);
      let cov = 0;
      for (let t = 0; t < nDays; t++) cov += (r[t] - mR) * (pnl[t] - mP);
      cov /= nDays - 1;
      return { symbol: h.symbol.toUpperCase(), pctRisk: varP > 0 ? (h.value * cov) / varP : 0 };
    })
    .sort((a, b) => Math.abs(b.pctRisk) - Math.abs(a.pctRisk));

  const base = opts.aum && opts.aum > 0 ? opts.aum : totalGross;
  const volAnn = volDaily * Math.sqrt(TRADING_DAYS);

  // Single-factor (market) decomposition: R² of the book's P&L on the market return is the systematic
  // share of variance; the rest is stock-specific. Needs the market return vector (else all null).
  let factorShare: number | null = null, volFactorDollar: number | null = null, volSpecificDollar: number | null = null;
  let factorBreakdown: { factor: string; share: number }[] | null = null;
  if (aligned.market && aligned.market.length === nDays && volDaily > 0) {
    const r = correlation(pnl, aligned.market);
    factorShare = Math.max(0, Math.min(1, r * r));
    volFactorDollar = volAnn * Math.sqrt(factorShare);
    volSpecificDollar = volAnn * Math.sqrt(1 - factorShare);
    const factors = buildEtfFactors(aligned.extra, aligned.market);
    if (factors) factorBreakdown = factorDecomp(pnl, factors);
  }

  return {
    nDays,
    coverage,
    volDailyDollar: volDaily,
    volAnnDollar: volAnn,
    volAnnPct: base > 0 ? volAnn / base : null,
    baseIsAum: !!(opts.aum && opts.aum > 0),
    factorShare,
    volFactorDollar,
    volSpecificDollar,
    factorBreakdown,
    var95Dollar: var95,
    var99Dollar: var99,
    es95Dollar: es95,
    worstDayDollar: worst,
    worstDayDate: worstIdx >= 0 ? dates[worstIdx] : null,
    undiversifiedVolDailyDollar: undiv,
    diversificationBenefit,
    contributions,
  };
}

export interface BenchmarkRisk {
  benchmark: string;
  trackingErrorPct: number; // annualized std of (book − benchmark) return
  activeBeta: number; // book beta vs the benchmark
  correlation: number;
  bookVolPct: number; // annualized book vol (return on `base`)
  benchVolPct: number;
  upCapture: number | null; // book vs benchmark on up days (1.2 = capture 120% of the upside)
  downCapture: number | null; // ... on down days (0.8 = only 80% of the downside)
}

/**
 * Benchmark-relative (active) risk: treat the book's daily P&L as a return on `base` (AUM or gross) and
 * compare it to a benchmark ETF's return (from aligned.extra) — tracking error, active beta, correlation,
 * and up/down capture. null if the benchmark series or book history is missing.
 */
export function benchmarkRisk(
  holdings: { symbol: string; value: number }[],
  aligned: AlignedReturns,
  benchmark: string,
  base: number,
): BenchmarkRisk | null {
  const { dates, returns, extra } = aligned;
  const nDays = dates.length;
  const bench = extra?.[benchmark];
  if (!bench || bench.length !== nDays || nDays < 30 || !(base > 0)) return null;
  const withSeries = holdings.filter((h) => returns[h.symbol.toUpperCase()]?.length === nDays);
  if (!withSeries.length) return null;

  const pnl = new Array<number>(nDays).fill(0);
  for (const h of withSeries) {
    const r = returns[h.symbol.toUpperCase()];
    for (let t = 0; t < nDays; t++) pnl[t] += h.value * r[t];
  }
  const rBook = pnl.map((p) => p / base);
  const mBk = mean(rBook), mBn = mean(bench);
  const varBn = bench.reduce((a, x) => a + (x - mBn) * (x - mBn), 0) / (nDays - 1);
  let cov = 0;
  for (let t = 0; t < nDays; t++) cov += (rBook[t] - mBk) * (bench[t] - mBn);
  cov /= nDays - 1;
  const active = rBook.map((r, t) => r - bench[t]);

  let upB = 0, upBk = 0, nUp = 0, dnB = 0, dnBk = 0, nDn = 0;
  for (let t = 0; t < nDays; t++) {
    if (bench[t] > 0) { upB += bench[t]; upBk += rBook[t]; nUp++; }
    else if (bench[t] < 0) { dnB += bench[t]; dnBk += rBook[t]; nDn++; }
  }
  return {
    benchmark,
    trackingErrorPct: std(active) * Math.sqrt(TRADING_DAYS),
    activeBeta: varBn > 0 ? cov / varBn : 0,
    correlation: correlation(rBook, bench),
    bookVolPct: std(rBook) * Math.sqrt(TRADING_DAYS),
    benchVolPct: std(bench) * Math.sqrt(TRADING_DAYS),
    upCapture: nUp && upB !== 0 ? upBk / upB : null,
    downCapture: nDn && dnB !== 0 ? dnBk / dnB : null,
  };
}

// ---------------------------------------------------------------------------
// Factor RETURN attribution + active factor exposures + factor betas.
// These share one engine: ridge-OLS of a daily return vector on the ETF-spread
// factor menu (buildEtfFactors), reused from the variance decomposition above.
// ---------------------------------------------------------------------------

/** Ridge OLS of `y` (a daily return vector) on the factor spreads → betas + fit R². null if unsolvable. */
function ridgeFactorBetas(y: number[], factors: Record<string, number[]>): { names: string[]; b: number[]; r2: number } | null {
  const names = Object.keys(factors);
  const k = names.length;
  if (!k || y.length < 2) return null;
  const F = names.map((f) => factors[f]);
  const mF = F.map(meanOf), mY = meanOf(y);
  const FtF = F.map((fi, i) => F.map((fj, j) => covAbout(fi, fj, mF[i], mF[j])));
  const Fty = F.map((fi, i) => covAbout(y, fi, mY, mF[i]));
  const lam = 0.02 * ((FtF.reduce((a, row, i) => a + row[i], 0) / k) || 1);
  const A = FtF.map((row, i) => row.map((v, j) => v + (i === j ? lam : 0)));
  const b = solveLinear(A, Fty);
  if (!b) return null;
  const resid = y.map((yy, t) => yy - names.reduce((a, _f, i) => a + b[i] * F[i][t], 0));
  const mE = meanOf(resid);
  const varY = covAbout(y, y, mY, mY), varE = covAbout(resid, resid, mE, mE);
  const r2 = varY > 0 ? Math.max(0, Math.min(1, 1 - varE / varY)) : 0;
  return { names, b, r2 };
}

/** Book daily return on `base` + the factor spreads, both sliced to the last `windowDays` (all history if omitted). */
function bookReturnAndFactors(
  holdings: { symbol: string; value: number }[],
  aligned: AlignedReturns,
  base: number,
  windowDays?: number,
): { rBook: number[]; factors: Record<string, number[]>; start: number; covered: number } | null {
  const nAll = aligned.dates.length;
  if (!aligned.market || aligned.market.length !== nAll || !(base > 0)) return null;
  const w = windowDays ? Math.min(windowDays, nAll) : nAll;
  if (w < 20) return null;
  const start = nAll - w;
  const returns = aligned.returns;
  const withSeries = holdings.filter((h) => returns[h.symbol.toUpperCase()]?.length === nAll);
  if (!withSeries.length) return null;
  const totalGross = holdings.reduce((a, h) => a + Math.abs(h.value), 0) || 1;
  const covered = withSeries.reduce((a, h) => a + Math.abs(h.value), 0) / totalGross;
  const rBook = new Array<number>(w).fill(0);
  for (const h of withSeries) {
    const r = returns[h.symbol.toUpperCase()];
    for (let t = 0; t < w; t++) rBook[t] += (h.value / base) * r[start + t];
  }
  const extraSl: Record<string, number[]> = {};
  for (const [k, v] of Object.entries(aligned.extra ?? {})) if (v.length === nAll) extraSl[k] = v.slice(start);
  const factors = buildEtfFactors(extraSl, aligned.market.slice(start));
  if (!factors) return null;
  return { rBook, factors, start, covered };
}

export interface ReturnAttribution {
  windowDays: number;
  covered: number;
  totalRet: number; // book arithmetic return over the window (Σ daily return on base)
  factors: { factor: string; ret: number }[]; // additive factor return contributions
  specific: number; // selection / stock-picking = totalRet − Σ factor contributions (the daily alpha × days)
  r2: number; // how much of the daily variation the factors explain
}

/**
 * Factor RETURN attribution over a window: regress the book's daily return on the factor spreads, then each
 * factor's contribution = βₖ · (its summed return over the window); the plug (totalRet − Σ contributions)
 * is the selection/alpha the factors don't explain. Additive by construction. The Omega-Point tearsheet
 * question "where did my return come from" — vs the variance version in computePortfolioRisk. null if no
 * market/factor series or < 20 shared days.
 */
export function returnAttribution(
  holdings: { symbol: string; value: number }[],
  aligned: AlignedReturns,
  base: number,
  windowDays: number,
): ReturnAttribution | null {
  const bf = bookReturnAndFactors(holdings, aligned, base, windowDays);
  if (!bf) return null;
  const fit = ridgeFactorBetas(bf.rBook, bf.factors);
  if (!fit) return null;
  const totalRet = bf.rBook.reduce((a, x) => a + x, 0);
  const contrib = fit.names.map((f, i) => ({ factor: f, ret: fit.b[i] * bf.factors[f].reduce((a, x) => a + x, 0) }));
  const specific = totalRet - contrib.reduce((a, c) => a + c.ret, 0);
  return { windowDays: bf.rBook.length, covered: bf.covered, totalRet, factors: contrib, specific, r2: fit.r2 };
}

export interface FactorExposure { factor: string; beta: number }

/** Book factor betas over the full aligned window (loading per unit factor move) — powers the shock scenario. */
export function factorBetas(
  holdings: { symbol: string; value: number }[],
  aligned: AlignedReturns,
  base: number,
): { exposures: FactorExposure[]; covered: number; r2: number } | null {
  const bf = bookReturnAndFactors(holdings, aligned, base);
  if (!bf) return null;
  const fit = ridgeFactorBetas(bf.rBook, bf.factors);
  if (!fit) return null;
  return { exposures: fit.names.map((f, i) => ({ factor: f, beta: fit.b[i] })), covered: bf.covered, r2: fit.r2 };
}

export interface ActiveFactorExposure {
  benchmark: string;
  covered: number;
  exposures: FactorExposure[]; // active loading = book loading − benchmark loading (from the active return)
  r2: number;
}

/**
 * Active factor exposures vs a benchmark: regress the ACTIVE return (book − benchmark) on the factor spreads
 * → the factor bets that differ from the benchmark (+Momentum = more momentum-tilted than SPY, etc.). This is
 * what actually drives the tracking error benchmarkRisk reports as one number. null if the benchmark series
 * or shared history is missing.
 */
export function activeFactorExposure(
  holdings: { symbol: string; value: number }[],
  aligned: AlignedReturns,
  benchmark: string,
  base: number,
  windowDays?: number,
): ActiveFactorExposure | null {
  const bench = aligned.extra?.[benchmark];
  const bf = bookReturnAndFactors(holdings, aligned, base, windowDays);
  if (!bf || !bench || bench.length !== aligned.dates.length) return null;
  const active = bf.rBook.map((r, t) => r - bench[bf.start + t]);
  const fit = ridgeFactorBetas(active, bf.factors);
  if (!fit) return null;
  return { benchmark, covered: bf.covered, exposures: fit.names.map((f, i) => ({ factor: f, beta: fit.b[i] })), r2: fit.r2 };
}
