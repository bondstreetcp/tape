/**
 * Leaders Board — a universe-wide relative-strength + breakout ranker. For every name we
 * percentile-rank multi-timeframe returns against the rest of the universe (the IBD-style RS
 * rating, 1–99), blend them into one composite RS, and place each name in an RRG-style quadrant
 * (Leading / Improving / Weakening / Lagging) from its RS level vs its RS momentum. A breakout
 * tag flags names near a 52-week high that are also in a golden cross above their 200-day MA.
 * Pure compute over the snapshot — no new data feed.
 */
import type { StockRow } from "./types";

export type Quadrant = "Leading" | "Improving" | "Weakening" | "Lagging";

export interface LeaderRow {
  symbol: string;
  name: string;
  sector: string;
  marketCap: number;
  price: number;
  ret1w: number | null;
  ret3m: number | null;
  ret6m: number | null;
  ret1y: number | null;
  rs: number; // 0–100 composite relative-strength percentile (vs the universe)
  rsLong: number; // longer-horizon RS level (the RRG x-axis)
  momentum: number; // rsShort − rsLong (the RRG y-axis; >0 = accelerating)
  quadrant: Quadrant;
  pctFromHigh: number;
  aboveMa200: boolean | null;
  goldenCross: boolean | null;
  breakout: boolean; // near 52wH + golden cross + above 200-day MA
}

export const QUADRANTS: Quadrant[] = ["Leading", "Improving", "Weakening", "Lagging"];
export const QUADRANT_META: Record<Quadrant, { color: string; blurb: string }> = {
  Leading: { color: "#22c55e", blurb: "Strong and still accelerating" },
  Improving: { color: "#38bdf8", blurb: "Weak but turning up — early movers" },
  Weakening: { color: "#f59e0b", blurb: "Strong but losing momentum" },
  Lagging: { color: "#ef4444", blurb: "Weak and still fading" },
};

/** Percentile-rank rows by `val` (higher value → higher percentile); null values get a neutral 50. */
function pctRanks(rows: StockRow[], val: (s: StockRow) => number | null | undefined): Map<string, number> {
  const valid = rows.filter((r) => val(r) != null);
  const sorted = [...valid].sort((a, b) => (val(a) as number) - (val(b) as number));
  const n = sorted.length;
  const m = new Map<string, number>();
  sorted.forEach((r, i) => m.set(r.symbol, n > 1 ? (i / (n - 1)) * 100 : 50));
  return m;
}

export function buildLeaders(stocks: StockRow[]): LeaderRow[] {
  const rows = stocks.filter((s) => s.returns && (s.marketCap || 0) > 0);
  if (rows.length < 10) return [];
  const p1w = pctRanks(rows, (s) => s.returns["1w"]);
  const p3m = pctRanks(rows, (s) => s.returns["3m"]);
  const p6m = pctRanks(rows, (s) => s.returns["6m"]);
  const p1y = pctRanks(rows, (s) => s.returns["1y"]);
  const get = (m: Map<string, number>, sym: string) => m.get(sym) ?? 50;

  // Blend the timeframe percentiles into a composite, then re-percentile so RS is a clean 1–99.
  const scored = rows.map((s) => {
    const a = get(p1w, s.symbol), b = get(p3m, s.symbol), c = get(p6m, s.symbol), d = get(p1y, s.symbol);
    return {
      s,
      raw: 0.1 * a + 0.2 * b + 0.3 * c + 0.4 * d, // longer horizons weighted more (IBD-style)
      rsLong: 0.2 * b + 0.3 * c + 0.5 * d, // the RRG "RS-Ratio" level
      rsShort: 0.4 * a + 0.6 * b, // recent strength
    };
  });
  const byRaw = [...scored].sort((x, y) => x.raw - y.raw);
  const n = byRaw.length;
  const rsMap = new Map<string, number>();
  byRaw.forEach((x, i) => rsMap.set(x.s.symbol, n > 1 ? (i / (n - 1)) * 100 : 50));

  const out: LeaderRow[] = scored.map(({ s, rsLong, rsShort }) => {
    const momentum = rsShort - rsLong;
    const strong = rsLong >= 50;
    const quadrant: Quadrant = strong ? (momentum >= 0 ? "Leading" : "Weakening") : momentum > 0 ? "Improving" : "Lagging";
    const aboveMa200 = s.twoHundredDayAverage != null && s.price ? s.price >= s.twoHundredDayAverage : null;
    const goldenCross = s.fiftyDayAverage != null && s.twoHundredDayAverage != null ? s.fiftyDayAverage > s.twoHundredDayAverage : null;
    const breakout = s.pctFromHigh >= -3 && goldenCross === true && aboveMa200 === true;
    return {
      symbol: s.symbol,
      name: s.name,
      sector: s.sector,
      marketCap: s.marketCap,
      price: s.price,
      ret1w: s.returns["1w"],
      ret3m: s.returns["3m"],
      ret6m: s.returns["6m"],
      ret1y: s.returns["1y"],
      rs: Math.round(rsMap.get(s.symbol) ?? 50),
      rsLong: Math.round(rsLong),
      momentum: Math.round(momentum),
      quadrant,
      pctFromHigh: s.pctFromHigh,
      aboveMa200,
      goldenCross,
      breakout,
    };
  });
  return out.sort((a, b) => b.rs - a.rs);
}
