/**
 * Shared log-linear trend-channel math for the valuation models (indices + sectors). Pure compute — no
 * fs/network. OLS-fits ln(price) on time, then builds ±1σ/±2σ residual bands + the current z-score read.
 * Used by scripts/refresh-index-trend.ts and scripts/refresh-sector-trend.ts so the two can never drift.
 */
import { verdictFromZ } from "./indexTrend";
import type { IndexTrend, TrendPoint } from "./indexTrend";

export type TrendObs = { t: number; price: number };
export interface TrendMeta { key: string; label: string; symbol: string; source: string }

const YEAR_MS = 365.25 * 86_400_000;
const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
const round = (v: number) => Math.round(v * 100) / 100;

/** Fit ln(price)~years, draw the ±1σ/±2σ channel, and read where price sits now. null if <60 obs. */
export function buildTrendChannel(meta: TrendMeta, series: TrendObs[], current: TrendObs | null): IndexTrend | null {
  const pts = series.filter((p) => p.price > 0).sort((a, b) => a.t - b.t);
  if (pts.length < 60) return null;
  if (current && current.price > 0 && current.t > pts[pts.length - 1].t) pts.push(current); // freshest point
  const cur = pts[pts.length - 1];
  const startMs = pts[0].t;
  const xs = pts.map((p) => (p.t - startMs) / YEAR_MS);
  const ys = pts.map((p) => Math.log(p.price));
  const n = xs.length, mx = mean(xs), my = mean(ys);
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) { sxx += (xs[i] - mx) ** 2; sxy += (xs[i] - mx) * (ys[i] - my); }
  const b = sxy / sxx, a = my - b * mx; // ln(price) = a + b·years
  let ss = 0; for (let i = 0; i < n; i++) { const r = ys[i] - (a + b * xs[i]); ss += r * r; }
  const sigma = Math.sqrt(ss / (n - 2)); // residual std (log space)
  const trendAt = (t: number) => Math.exp(a + b * ((t - startMs) / YEAR_MS));
  const point = (p: TrendObs): TrendPoint => {
    const tr = trendAt(p.t);
    return [p.t, round(p.price), round(tr), round(tr * Math.exp(-sigma)), round(tr * Math.exp(sigma)), round(tr * Math.exp(-2 * sigma)), round(tr * Math.exp(2 * sigma))];
  };
  const step = Math.max(1, Math.ceil(n / 200)); // downsample for the chart
  const history: TrendPoint[] = [];
  for (let i = 0; i < n; i += step) history.push(point(pts[i]));
  if ((n - 1) % step !== 0) history.push(point(cur));
  const trendNow = trendAt(cur.t);
  const z = (Math.log(cur.price) - Math.log(trendNow)) / sigma;
  return {
    key: meta.key, label: meta.label, symbol: meta.symbol,
    startYear: new Date(startMs).getUTCFullYear(), nMonths: n,
    cagrPct: (Math.exp(b) - 1) * 100, current: round(cur.price), currentDate: new Date(cur.t).toISOString().slice(0, 10),
    trendNow: round(trendNow), pctFromTrend: (cur.price / trendNow - 1) * 100,
    z, sigma1Pct: (Math.exp(sigma) - 1) * 100, verdict: verdictFromZ(z), history, source: meta.source,
  };
}
