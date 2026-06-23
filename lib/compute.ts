import type { StockRow, SeriesPoint, XY } from "./types";
import type { TimeframeKey } from "./timeframes";

/** Within `threshold` % of the 52-week high (pctFromHigh is <= 0). */
export function isNearHigh(row: StockRow, threshold: number): boolean {
  return row.pctFromHigh >= -threshold;
}

/** Within `threshold` % of the 52-week low (pctFromLow is >= 0). */
export function isNearLow(row: StockRow, threshold: number): boolean {
  return row.pctFromLow <= threshold;
}

/**
 * Cap-weighted return over a set of names for a timeframe — the universe's OWN move for a
 * sector (or the whole index), computed from its constituents rather than a fixed sector ETF
 * (which is S&P-based and reads the same on every universe). We weight by each name's
 * START-of-period cap, recovered as cap/(1+return); weighting by the current (post-move) cap
 * would over-count names that already rallied and skew longer windows. Returns are in percent.
 */
export function capWeightedReturn(stocks: StockRow[], tf: TimeframeKey): number | null {
  let wsum = 0;
  let rsum = 0;
  for (const s of stocks) {
    const r = s.returns[tf];
    const cap = s.marketCap;
    if (r == null || cap == null || !(cap > 0)) continue;
    const denom = 1 + r / 100;
    if (denom <= 0) continue; // skip ~total-loss outliers (start cap → ∞)
    const cap0 = cap / denom;
    wsum += cap0;
    rsum += cap0 * r;
  }
  return wsum > 0 ? rsum / wsum : null;
}

export type HighLowFilter = "all" | "high" | "low" | "either";

export function matchesFilter(
  row: StockRow,
  filter: HighLowFilter,
  threshold: number,
): boolean {
  switch (filter) {
    case "high":
      return isNearHigh(row, threshold);
    case "low":
      return isNearLow(row, threshold);
    case "either":
      return isNearHigh(row, threshold) || isNearLow(row, threshold);
    case "all":
    default:
      return true;
  }
}

export interface HighLowTally {
  near52High: number;
  near52Low: number;
}

export function tallyHighLow(rows: StockRow[], threshold: number): HighLowTally {
  let near52High = 0;
  let near52Low = 0;
  for (const r of rows) {
    if (isNearHigh(r, threshold)) near52High++;
    if (isNearLow(r, threshold)) near52Low++;
  }
  return { near52High, near52Low };
}

/** Slice a price series to the window implied by a timeframe. */
export function sliceSeries(
  intraday: SeriesPoint[],
  daily: SeriesPoint[],
  tf: TimeframeKey,
  now: number,
): SeriesPoint[] {
  const DAY = 86_400_000;
  if (tf === "1d") {
    // last session present in the intraday feed
    if (intraday.length === 0) return [];
    const lastT = intraday[intraday.length - 1].t;
    const lastDay = new Date(lastT);
    const startOfLastDay = new Date(
      lastDay.getFullYear(),
      lastDay.getMonth(),
      lastDay.getDate(),
    ).getTime();
    return intraday.filter((p) => p.t >= startOfLastDay);
  }
  if (tf === "1w") {
    const cutoff = now - 7 * DAY;
    const pts = intraday.filter((p) => p.t >= cutoff);
    return pts.length > 1 ? pts : intraday;
  }
  let cutoff: number;
  switch (tf) {
    case "3m":
      cutoff = now - 92 * DAY;
      break;
    case "6m":
      cutoff = now - 183 * DAY;
      break;
    case "ytd": {
      const y = new Date(now).getFullYear();
      cutoff = new Date(y, 0, 1).getTime();
      break;
    }
    case "3y":
      cutoff = now - 3 * 366 * DAY;
      break;
    case "5y":
      cutoff = now - 5 * 366 * DAY;
      break;
    case "1y":
    default:
      cutoff = now - 366 * DAY;
      break;
  }
  // Include the bar just before the window as the period baseline, so a chart anchors
  // to the period's starting price (YTD starts at the prior-year close, not the first
  // January bar) and the window's change ties out with the canonical returns[tf] shown
  // in the header and the screener.
  const i = daily.findIndex((p) => p.t >= cutoff);
  const pts = i < 0 ? [] : daily.slice(i > 0 ? i - 1 : 0);
  return pts.length > 1 ? pts : daily;
}

export function seriesChangePct(pts: SeriesPoint[]): number | null {
  if (pts.length < 2) return null;
  const first = pts[0].c;
  const last = pts[pts.length - 1].c;
  if (!first) return null;
  return (last / first - 1) * 100;
}

export function xyToPoints(xy: XY[]): SeriesPoint[] {
  return (xy || []).map(([t, c]) => ({ t, c }));
}

export interface ComparisonItem {
  symbol: string;
  intraday: SeriesPoint[];
  daily: SeriesPoint[];
}

export interface ComparisonResult {
  /** One row per timestamp: { t, [SYMBOL]: pctChange }. Missing keys are gaps. */
  rows: Array<Record<string, number>>;
  /** End-of-window % change per symbol, in the order items were passed. */
  meta: { symbol: string; endPct: number | null }[];
}

/**
 * The price a window's % change is measured from. For every tenor except 1D this is the first sliced
 * point — sliceSeries already prepends the prior-period bar so the change ties out with the canonical
 * returns[tf]. The 1D window starts at today's open, but the canonical daily return is measured vs the
 * PRIOR CLOSE, so anchor to the last bar before today's session (fallback: the daily series' last
 * close). Without this, a name that gapped overnight shows only its since-open move and disagrees with
 * the header's 1D % (e.g. XLB gaps down 1.3% pre-market → shows ~0% instead of −1.1%).
 */
function rebaseBaseline(
  intraday: SeriesPoint[],
  daily: SeriesPoint[],
  tf: TimeframeKey,
  sliced: SeriesPoint[],
): number | null {
  if (tf !== "1d") return sliced.length ? sliced[0].c : null;
  if (!sliced.length) return null;
  const d = new Date(sliced[0].t);
  const startOfToday = new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  for (let i = intraday.length - 1; i >= 0; i--) if (intraday[i].t < startOfToday) return intraday[i].c;
  if (daily.length) return daily[daily.length - 1].c;
  return sliced[0].c;
}

/**
 * Slice each series to the timeframe window, rebase it to % change from the
 * period baseline (see rebaseBaseline — prior close for 1D, the prepended prior bar
 * otherwise), and merge them all onto a shared time axis for a multi-line comparison chart.
 */
export function buildComparison(
  items: ComparisonItem[],
  tf: TimeframeKey,
  now: number,
): ComparisonResult {
  const perStock = items.map((it) => {
    const sliced = sliceSeries(it.intraday, it.daily, tf, now);
    const base = rebaseBaseline(it.intraday, it.daily, tf, sliced);
    const points =
      base && base !== 0
        ? sliced.map((p) => ({ t: p.t, v: (p.c / base - 1) * 100 }))
        : [];
    const endPct = points.length ? points[points.length - 1].v : null;
    const map = new Map<number, number>();
    for (const p of points) map.set(p.t, p.v);
    return { symbol: it.symbol, map, endPct };
  });

  const tset = new Set<number>();
  for (const s of perStock) for (const t of s.map.keys()) tset.add(t);
  const ts = [...tset].sort((a, b) => a - b);

  const rows = ts.map((t) => {
    const row: Record<string, number> = { t };
    for (const s of perStock) {
      const v = s.map.get(t);
      if (v !== undefined) row[s.symbol] = v;
    }
    return row;
  });

  return { rows, meta: perStock.map((s) => ({ symbol: s.symbol, endPct: s.endPct })) };
}
