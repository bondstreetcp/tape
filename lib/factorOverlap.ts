// Factor-Screen Overlap — runs all the named value/quality screens (Magic Formula, ERP5,
// Quality+Value, Net-Net, Piotroski, Shareholder Yield, Moat, Rule of 40, M&A target) over a
// universe and surfaces the names that land in the TOP of MULTIPLE of them. A name that's cheap
// AND high-quality AND improving AND returning cash shows up across several lenses — the kind of
// all-round profile a single screen can miss. Pure compute off the snapshot (no LLM, no cron).

import type { StockRow } from "./types";
import { screenSymbols, SCREEN_ORDER, type ScreenKey } from "./screens";

export interface FactorHit {
  key: ScreenKey;
  rank: number; // 0-based position within that screen (0 = best)
}
export interface FactorOverlapName {
  symbol: string;
  name: string;
  sector: string | null;
  marketCap: number | null;
  price: number | null;
  trailingPE: number | null;
  retYtd: number | null;
  screens: FactorHit[];
  count: number; // number of screens it lands in
  avgRank: number; // mean position across those screens (lower = stronger)
}

export function buildFactorOverlap(stocks: StockRow[], perScreen = 50): FactorOverlapName[] {
  const byName = new Map<string, FactorHit[]>();
  for (const key of SCREEN_ORDER) {
    const syms = screenSymbols(key, stocks, { topN: perScreen }).slice(0, perScreen);
    syms.forEach((s, i) => {
      const a = byName.get(s) || [];
      a.push({ key, rank: i });
      byName.set(s, a);
    });
  }
  const ctx = new Map(stocks.map((s) => [s.symbol, s] as const));
  const out: FactorOverlapName[] = [];
  for (const [sym, hits] of byName) {
    if (hits.length < 2) continue; // overlap = at least two lenses agree
    const s = ctx.get(sym);
    out.push({
      symbol: sym,
      name: s?.name || sym,
      sector: s?.sector ?? null,
      marketCap: s?.marketCap ?? null,
      price: s?.price ?? null,
      trailingPE: s?.trailingPE ?? null,
      retYtd: s?.returns?.ytd ?? null,
      screens: hits.sort((a, b) => SCREEN_ORDER.indexOf(a.key) - SCREEN_ORDER.indexOf(b.key)),
      count: hits.length,
      avgRank: hits.reduce((n, h) => n + h.rank, 0) / hits.length,
    });
  }
  return out.sort((a, b) => b.count - a.count || a.avgRank - b.avgRank);
}
