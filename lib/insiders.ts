/**
 * Insider Cluster-Buying — ranks the universe by recent open-market insider BUYS (SEC Form 4,
 * transaction code P) in a trailing window. The cluster signal: how many DISTINCT insiders bought
 * (conviction converges when several do), total $ committed (scaled by market cap), and how recent.
 * Corporate insiders buying their own stock with cash — especially on weakness — is a high-conviction
 * accumulation tell. Fed nightly by scripts/refresh-insiders.ts → data/insiders.json.
 */
import type { StockRow } from "./types";

export interface InsiderBuy { insider: string; role: string; date: string; shares: number | null; price: number | null; value: number | null }
export interface NameBuys {
  buyers: number; // # distinct insiders who bought in the window
  transactions: number;
  totalShares: number;
  totalValue: number | null; // sum of disclosed $ value (null if none priced)
  lastBuy: string; // YYYY-MM-DD of the most recent buy
  top: InsiderBuy[]; // largest buys (for the detail row)
}
export interface InsidersFile { generatedAt: string; asOf: string; windowDays: number; names: Record<string, NameBuys> }

export interface InsiderRow {
  symbol: string;
  name: string;
  sector: string;
  marketCap: number;
  price: number;
  buyers: number;
  transactions: number;
  totalValue: number | null;
  lastBuy: string;
  daysSince: number | null;
  pctFromHigh: number; // dip context — buying off the highs is higher-conviction
  clusterScore: number; // 0–100 composite
  top: InsiderBuy[];
}
export interface InsidersData { rows: InsiderRow[]; asOf: string; windowDays: number; coverage: number }

function pctRank(vals: { sym: string; v: number }[]): Map<string, number> {
  const sorted = [...vals].sort((a, b) => a.v - b.v);
  const n = sorted.length;
  const m = new Map<string, number>();
  sorted.forEach((x, i) => m.set(x.sym, n > 1 ? (i / (n - 1)) * 100 : 50));
  return m;
}

const daysBetween = (a: string, b: string): number | null => {
  const ta = Date.parse(a + "T00:00:00Z"), tb = Date.parse(b + "T00:00:00Z");
  return Number.isFinite(ta) && Number.isFinite(tb) ? Math.round((tb - ta) / 86400000) : null;
};

export function buildInsiderBuys(file: InsidersFile, stocks: StockRow[]): InsidersData {
  const bySym = new Map(stocks.map((s) => [s.symbol, s]));
  const raw: InsiderRow[] = [];
  for (const [sym, nb] of Object.entries(file.names)) {
    const s = bySym.get(sym);
    if (!s) continue; // restrict to the current universe
    raw.push({
      symbol: sym,
      name: s.name,
      sector: s.sector,
      marketCap: s.marketCap,
      price: s.price,
      buyers: nb.buyers,
      transactions: nb.transactions,
      totalValue: nb.totalValue,
      lastBuy: nb.lastBuy,
      daysSince: daysBetween(nb.lastBuy, file.asOf),
      pctFromHigh: s.pctFromHigh,
      clusterScore: 0,
      top: nb.top || [],
    });
  }

  // Composite = 0.5 cluster (# distinct buyers) + 0.3 magnitude ($ value ÷ market cap) + 0.2 recency.
  const rCluster = pctRank(raw.map((r) => ({ sym: r.symbol, v: r.buyers })));
  const rMag = pctRank(raw.map((r) => ({ sym: r.symbol, v: r.totalValue != null && r.marketCap ? r.totalValue / r.marketCap : 0 })));
  const rRecent = pctRank(raw.map((r) => ({ sym: r.symbol, v: r.daysSince != null ? -r.daysSince : -9999 }))); // more recent = higher
  for (const r of raw) {
    r.clusterScore = Math.round(0.5 * (rCluster.get(r.symbol) ?? 50) + 0.3 * (rMag.get(r.symbol) ?? 50) + 0.2 * (rRecent.get(r.symbol) ?? 50));
  }
  raw.sort((a, b) => b.clusterScore - a.clusterScore || b.buyers - a.buyers);

  return { rows: raw, asOf: file.asOf, windowDays: file.windowDays, coverage: raw.length };
}
