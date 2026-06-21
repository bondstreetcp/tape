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
 * Slice each series to the timeframe window, rebase it to % change from the
 * first point in the window (so price levels don't matter), and merge them all
 * onto a shared time axis for a multi-line comparison chart.
 */
export function buildComparison(
  items: ComparisonItem[],
  tf: TimeframeKey,
  now: number,
): ComparisonResult {
  const perStock = items.map((it) => {
    const sliced = sliceSeries(it.intraday, it.daily, tf, now);
    const base = sliced.length ? sliced[0].c : null;
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
