import { loadSnapshot, loadManySymbolSeries } from "./data";
import type { BacktestMatrix } from "./backtest";

const monthKey = (t: number) => {
  const d = new Date(t);
  return d.getUTCFullYear() * 12 + d.getUTCMonth();
};

/** Month-end close matrix for the top-N constituents by market cap — the input
 *  to the backtester. Built from the committed per-symbol daily series. */
export async function buildMonthlyMatrix(universe: string, topN = 200): Promise<BacktestMatrix | null> {
  const snap = await loadSnapshot(universe);
  if (!snap) return null;
  const top = [...snap.stocks]
    .filter((s) => s.marketCap && s.marketCap > 0)
    .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
    .slice(0, topN);
  const seriesMap = await loadManySymbolSeries(top.map((s) => s.symbol));

  const symMonth: Record<string, Map<number, { t: number; c: number }>> = {};
  const allMonths = new Set<number>();
  for (const s of top) {
    const ser = seriesMap[s.symbol];
    if (!ser?.daily?.length) continue;
    const m = new Map<number, { t: number; c: number }>();
    for (const [t, c] of ser.daily) {
      if (c == null || !(c > 0)) continue;
      const k = monthKey(t);
      const prev = m.get(k);
      if (!prev || t > prev.t) m.set(k, { t, c });
      allMonths.add(k);
    }
    symMonth[s.symbol] = m;
  }
  const months = [...allMonths].sort((a, b) => a - b);
  if (months.length < 13) return null;
  const dates = months.map((k) => Date.UTC(Math.floor(k / 12), (k % 12) + 1, 0));

  const symbols: string[] = [], names: string[] = [], sectors: string[] = [], caps: number[] = [], closes: (number | null)[][] = [];
  for (const s of top) {
    const m = symMonth[s.symbol];
    if (!m) continue;
    const row = months.map((k) => m.get(k)?.c ?? null);
    if (row.filter((v) => v != null).length < months.length * 0.7) continue; // need decent history
    symbols.push(s.symbol);
    names.push(s.name);
    sectors.push((s as any).sector || s.etf || "");
    caps.push(s.marketCap || 0);
    closes.push(row.map((v) => (v == null ? null : Math.round(v * 100) / 100)));
  }
  if (symbols.length < 20) return null;
  return { dates, symbols, names, sectors, caps, closes };
}
