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
}

const intersectDays = (acc: Set<number> | null, days: Set<number>): Set<number> => {
  if (acc == null) return days;
  const next = new Set<number>();
  for (const d of days) if (acc.has(d)) next.add(d);
  return next;
};
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
  // Fold the market series into the same shared axis (it trades every day, so it won't shrink the window).
  const marketBucket = market ? bucketByDay(market) : null;
  const marketMap = marketBucket && marketBucket.length >= 2 ? new Map<number, number>(marketBucket) : null;
  if (marketMap) common = intersectDays(common, new Set<number>(marketBucket!.map(([t]) => t)));

  let level = common ? Array.from(common).sort((a, b) => a - b) : [];
  if (level.length > lookback + 1) level = level.slice(level.length - (lookback + 1));

  const returns: Record<string, number[]> = {};
  if (level.length >= 2) {
    for (const s of syms) {
      const r = priceMaps[s].size >= 2 ? returnsOn(priceMaps[s], level) : null;
      if (r && r.length) returns[s.toUpperCase()] = r;
    }
  }
  const marketRet = marketMap && level.length >= 2 ? returnsOn(marketMap, level) : null;
  return { dates: level.slice(1), returns, ...(marketRet ? { market: marketRet } : {}) };
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
  if (aligned.market && aligned.market.length === nDays && volDaily > 0) {
    const r = correlation(pnl, aligned.market);
    factorShare = Math.max(0, Math.min(1, r * r));
    volFactorDollar = volAnn * Math.sqrt(factorShare);
    volSpecificDollar = volAnn * Math.sqrt(1 - factorShare);
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
