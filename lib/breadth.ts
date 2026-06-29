/**
 * Breadth & Regime — market internals computed over the universe snapshot: how many names are above
 * their 50/200-day moving averages (the T2108-style participation gauge), advancers vs decliners,
 * names at/near 52-week highs vs lows, the share of names positive over each timeframe, and a
 * per-sector breadth table. Plus a macro regime strip (curve, HY credit, VIX, financial conditions)
 * with each level percentiled against its own history. Pure compute — no new feed.
 */
import type { StockRow } from "./types";
import type { TimeframeKey } from "./timeframes";
import type { Macro } from "./fred";

export interface Gauge { pct: number; count: number; total: number }
export interface SectorBreadth {
  sector: string;
  total: number;
  pctAbove200: number;
  pctAbove50: number;
  avg1d: number | null;
}
export interface BreadthData {
  total: number;
  above200: Gauge; // % of names above their 200-day MA — the headline participation gauge
  above50: Gauge;
  golden: Gauge; // % in a golden cross (50d > 200d)
  nearHigh: Gauge; // within 3% of the 52-week high
  nearLow: Gauge;
  advancers: number;
  decliners: number;
  unchanged: number;
  newHighs: number; // at the 52-week high (within 0.5%)
  newLows: number;
  trend: { tf: string; pctUp: number }[]; // % of names positive over each timeframe
  sectors: SectorBreadth[];
  verdict: { tone: "up" | "neutral" | "down"; text: string };
}

const gauge = (count: number, total: number): Gauge => ({ pct: total ? Math.round((count / total) * 100) : 0, count, total });

export function buildBreadth(stocks: StockRow[]): BreadthData {
  const withMa200 = stocks.filter((s) => s.twoHundredDayAverage != null && s.price);
  const withMa50 = stocks.filter((s) => s.fiftyDayAverage != null && s.price);
  const withCross = stocks.filter((s) => s.fiftyDayAverage != null && s.twoHundredDayAverage != null);
  const above200 = withMa200.filter((s) => s.price >= s.twoHundredDayAverage!).length;
  const above50 = withMa50.filter((s) => s.price >= s.fiftyDayAverage!).length;
  const golden = withCross.filter((s) => s.fiftyDayAverage! > s.twoHundredDayAverage!).length;

  let adv = 0, dec = 0, unch = 0;
  for (const s of stocks) {
    const r = s.returns?.["1d"];
    if (r == null) continue;
    if (r > 0.05) adv++;
    else if (r < -0.05) dec++;
    else unch++;
  }

  const tfs: [string, TimeframeKey][] = [["1W", "1w"], ["3M", "3m"], ["6M", "6m"], ["1Y", "1y"]];
  const trend = tfs.map(([tf, k]) => {
    const vals = stocks.map((s) => s.returns?.[k]).filter((v): v is number => v != null);
    return { tf, pctUp: vals.length ? Math.round((vals.filter((v) => v > 0).length / vals.length) * 100) : 0 };
  });

  const bySector = new Map<string, StockRow[]>();
  for (const s of stocks) {
    if (!s.sector) continue;
    const list = bySector.get(s.sector);
    if (list) list.push(s);
    else bySector.set(s.sector, [s]);
  }
  const sectors: SectorBreadth[] = [...bySector.entries()]
    .map(([sector, list]) => {
      const m2 = list.filter((s) => s.twoHundredDayAverage != null && s.price);
      const m5 = list.filter((s) => s.fiftyDayAverage != null && s.price);
      const d1 = list.map((s) => s.returns?.["1d"]).filter((v): v is number => v != null);
      return {
        sector,
        total: list.length,
        pctAbove200: m2.length ? Math.round((m2.filter((s) => s.price >= s.twoHundredDayAverage!).length / m2.length) * 100) : 0,
        pctAbove50: m5.length ? Math.round((m5.filter((s) => s.price >= s.fiftyDayAverage!).length / m5.length) * 100) : 0,
        avg1d: d1.length ? d1.reduce((x, y) => x + y, 0) / d1.length : null,
      };
    })
    .sort((a, b) => b.pctAbove200 - a.pctAbove200);

  const p200 = gauge(above200, withMa200.length).pct;
  const verdict =
    p200 >= 60
      ? { tone: "up" as const, text: `Broad — ${p200}% of names are above their 200-day MA. The trend has wide participation.` }
      : p200 >= 40
        ? { tone: "neutral" as const, text: `Mixed — ${p200}% of names are above their 200-day MA. Leadership is selective.` }
        : { tone: "down" as const, text: `Narrow — only ${p200}% of names are above their 200-day MA. A few names may be carrying the tape.` };

  return {
    total: stocks.length,
    above200: gauge(above200, withMa200.length),
    above50: gauge(above50, withMa50.length),
    golden: gauge(golden, withCross.length),
    nearHigh: gauge(stocks.filter((s) => s.pctFromHigh >= -3).length, stocks.length),
    nearLow: gauge(stocks.filter((s) => s.pctFromLow <= 3).length, stocks.length),
    advancers: adv,
    decliners: dec,
    unchanged: unch,
    newHighs: stocks.filter((s) => s.pctFromHigh >= -0.5).length,
    newLows: stocks.filter((s) => s.pctFromLow <= 0.5).length,
    trend,
    sectors,
    verdict,
  };
}

export interface RegimeItem { label: string; value: number | null; unit: string; pctile: number | null; note: string; tone: "up" | "neutral" | "down" }

function indPctile(hist: [string, number][] | undefined, val: number | null | undefined): number | null {
  if (!hist || !hist.length || val == null) return null;
  const vals = hist.map((h) => h[1]).filter((v) => Number.isFinite(v));
  if (!vals.length) return null;
  return Math.round((vals.filter((v) => v <= val).length / vals.length) * 100);
}

/** US macro regime barometer — the global risk backdrop, shown alongside breadth for context. */
export function buildRegime(macro: Macro): RegimeItem[] {
  const ind = (k: string) => macro.indicators?.find((i) => i.key === k);
  const out: RegimeItem[] = [];
  const vix = ind("vix"), hy = ind("hy"), t102 = ind("t102"), nfci = ind("nfci");
  if (vix) out.push({ label: "VIX", value: vix.value, unit: "", pctile: indPctile(vix.history, vix.value), note: vix.value == null ? "" : vix.value < 15 ? "calm" : vix.value < 22 ? "normal" : vix.value < 30 ? "elevated" : "stressed", tone: (vix.value ?? 0) < 20 ? "up" : (vix.value ?? 0) < 28 ? "neutral" : "down" });
  if (hy) out.push({ label: "HY credit (OAS)", value: hy.value, unit: "%", pctile: indPctile(hy.history, hy.value), note: hy.value == null ? "" : hy.value < 3.5 ? "tight" : hy.value < 5 ? "normal" : "widening", tone: (hy.value ?? 0) < 3.5 ? "up" : (hy.value ?? 0) < 5 ? "neutral" : "down" });
  if (t102) out.push({ label: "10Y–2Y curve", value: t102.value, unit: "pp", pctile: indPctile(t102.history, t102.value), note: (t102.value ?? 0) < 0 ? "inverted" : "positive", tone: (t102.value ?? 0) < 0 ? "down" : "up" });
  if (nfci) out.push({ label: "Fin. conditions", value: nfci.value, unit: "", pctile: indPctile(nfci.history, nfci.value), note: (nfci.value ?? 0) < 0 ? "loose" : "tight", tone: (nfci.value ?? 0) < 0 ? "up" : "down" });
  return out;
}
