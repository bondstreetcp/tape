/**
 * Lightweight strategy backtester over a monthly close matrix. Strategies are
 * PRICE-based only (momentum, trend, low-vol, equal-weight) — we don't store
 * point-in-time fundamentals, so fundamental screens can't be backtested without
 * look-ahead bias. Uses the current universe constituents, so results carry
 * survivorship bias (delisted names are absent) — surfaced in the UI.
 */
export interface BacktestMatrix {
  dates: number[]; // month-end epoch ms
  symbols: string[];
  names: string[];
  sectors: string[];
  caps: number[];
  closes: (number | null)[][]; // [symbolIdx][monthIdx]
}

export type StrategyKey = "momentum" | "trend" | "lowvol" | "equal";
export interface StrategyConfig { strategy: StrategyKey; topN?: number; lookback?: number }

export interface BacktestResult {
  dates: number[];
  strategy: number[]; // equity curve, base 100
  benchmark: number[];
  metrics: {
    months: number;
    stratTotal: number; benchTotal: number;
    stratCagr: number; benchCagr: number;
    maxDD: number; vol: number; sharpe: number;
  };
  holdingsLast: string[];
}

const STRATEGY_LABELS: Record<StrategyKey, string> = {
  momentum: "Momentum (top by trailing return)",
  trend: "Trend (above 10-month average)",
  lowvol: "Low volatility",
  equal: "Equal-weight all",
};
export const strategyLabel = (k: StrategyKey) => STRATEGY_LABELS[k];

export function runStrategy(mx: BacktestMatrix, cfg: StrategyConfig): BacktestResult | null {
  const N = mx.symbols.length;
  const M = mx.dates.length;
  const lookback = Math.max(2, cfg.lookback ?? 6);
  const topN = Math.max(5, cfg.topN ?? 20);
  const warm = Math.max(lookback, 10) + 1;
  if (M <= warm + 2) return null;

  const ret = (i: number, j: number): number | null => {
    const a = mx.closes[i][j], b = mx.closes[i][j - 1];
    return a != null && b != null && b > 0 ? a / b - 1 : null;
  };
  const capWeighted = (j: number): number => {
    let w = 0, r = 0;
    for (let i = 0; i < N; i++) {
      const ri = ret(i, j);
      if (ri == null) continue;
      const wi = mx.caps[i] || 0;
      w += wi; r += wi * ri;
    }
    return w > 0 ? r / w : 0;
  };

  const score = (i: number, j: number): number | null => {
    if (cfg.strategy === "momentum") {
      const a = mx.closes[i][j], b = mx.closes[i][j - lookback];
      return a != null && b != null && b > 0 ? a / b - 1 : null;
    }
    if (cfg.strategy === "trend") {
      let sum = 0, cnt = 0;
      for (let k = j - 9; k <= j; k++) { const v = mx.closes[i][k]; if (v != null) { sum += v; cnt++; } }
      const ma = cnt >= 8 ? sum / cnt : null;
      const px = mx.closes[i][j];
      return ma != null && px != null ? (px > ma ? 1 : -1) : null;
    }
    if (cfg.strategy === "lowvol") {
      const rs: number[] = [];
      for (let k = j - lookback + 1; k <= j; k++) { const r = ret(i, k); if (r != null) rs.push(r); }
      if (rs.length < lookback * 0.7) return null;
      const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
      return -Math.sqrt(rs.reduce((a, b) => a + (b - mean) ** 2, 0) / rs.length);
    }
    return 1; // equal
  };

  const stratRet: number[] = [], benchRet: number[] = [];
  let holdingsLast: string[] = [];
  for (let j = warm; j < M; j++) {
    // select using info available at j-1, realize the return over j-1 → j
    let picks: number[];
    if (cfg.strategy === "trend") {
      picks = [];
      for (let i = 0; i < N; i++) if (score(i, j - 1) === 1) picks.push(i);
    } else if (cfg.strategy === "equal") {
      picks = [];
      for (let i = 0; i < N; i++) if (ret(i, j) != null) picks.push(i);
    } else {
      const scored: { i: number; s: number }[] = [];
      for (let i = 0; i < N; i++) { const s = score(i, j - 1); if (s != null) scored.push({ i, s }); }
      scored.sort((a, b) => b.s - a.s);
      picks = scored.slice(0, topN).map((x) => x.i);
    }
    const rs = picks.map((i) => ret(i, j)).filter((r): r is number => r != null);
    stratRet.push(rs.length ? rs.reduce((a, b) => a + b, 0) / rs.length : 0); // empty (all cash) → 0%
    benchRet.push(capWeighted(j));
    if (j === M - 1) holdingsLast = picks.map((i) => mx.symbols[i]);
  }

  const eq = (rets: number[]) => {
    const out = [100];
    for (const r of rets) out.push(out[out.length - 1] * (1 + r));
    return out;
  };
  const stratEq = eq(stratRet), benchEq = eq(benchRet);
  const dates = mx.dates.slice(warm - 1);
  const months = stratRet.length;
  const years = months / 12;
  const total = (e: number[]) => e[e.length - 1] / e[0] - 1;
  const cagr = (e: number[]) => (years > 0 ? Math.pow(e[e.length - 1] / e[0], 1 / years) - 1 : 0);
  let peak = stratEq[0], maxDD = 0;
  for (const v of stratEq) { if (v > peak) peak = v; const dd = v / peak - 1; if (dd < maxDD) maxDD = dd; }
  const mean = stratRet.reduce((a, b) => a + b, 0) / (months || 1);
  const vol = Math.sqrt(stratRet.reduce((a, b) => a + (b - mean) ** 2, 0) / (months || 1)) * Math.sqrt(12);
  const sharpe = vol > 0 ? (mean * 12) / vol : 0;

  return {
    dates,
    strategy: stratEq,
    benchmark: benchEq,
    metrics: { months, stratTotal: total(stratEq), benchTotal: total(benchEq), stratCagr: cagr(stratEq), benchCagr: cagr(benchEq), maxDD, vol, sharpe },
    holdingsLast,
  };
}
