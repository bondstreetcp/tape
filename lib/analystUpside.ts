/**
 * Analyst Upside — ranks the universe by consensus price-target upside (mean target ÷ price − 1),
 * with the Street's Buy/Hold/Sell rating and the high–low target dispersion alongside. Reads the
 * nightly estimate snapshot (data/estimates.json, which carries target/price/rating per name).
 * Where the Street sees the most room — read with the rating (big upside on a Hold = stale targets
 * or a falling price, not conviction).
 */
import type { StockRow } from "./types";
import type { EstimatesFile } from "./revisions";

export type RecTone = "up" | "neutral" | "down";

export interface UpsideRow {
  symbol: string;
  name: string;
  sector: string;
  marketCap: number;
  price: number;
  target: number;
  targetHigh: number | null;
  targetLow: number | null;
  upsidePct: number; // target / price − 1
  rangePct: number | null; // (high − low) / price — target dispersion
  recLabel: string;
  recTone: RecTone;
  analysts: number | null;
}
export interface SectorUpside { sector: string; total: number; avgUpside: number }
export interface UpsideData { rows: UpsideRow[]; sectors: SectorUpside[]; asOf: string | null; coverage: number }

const REC: Record<string, { label: string; tone: RecTone }> = {
  strong_buy: { label: "Strong Buy", tone: "up" },
  buy: { label: "Buy", tone: "up" },
  hold: { label: "Hold", tone: "neutral" },
  underperform: { label: "Underperform", tone: "down" },
  sell: { label: "Sell", tone: "down" },
  strong_sell: { label: "Strong Sell", tone: "down" },
};
function recInfo(key: string | null | undefined, mean: number | null | undefined): { label: string; tone: RecTone } {
  if (key && REC[key]) return REC[key];
  if (mean == null) return { label: "—", tone: "neutral" };
  if (mean <= 1.5) return REC.strong_buy;
  if (mean <= 2.5) return REC.buy;
  if (mean <= 3.5) return REC.hold;
  if (mean <= 4.5) return { label: "Sell", tone: "down" };
  return REC.strong_sell;
}

/** True when a row's consensus rating is Buy or Strong Buy (for the "Buy-rated only" filter). */
export function isBuyRated(tone: RecTone, label: string): boolean {
  return tone === "up" || label === "Strong Buy" || label === "Buy";
}

export function buildAnalystUpside(file: EstimatesFile, stocks: StockRow[]): UpsideData {
  const bySym = new Map(stocks.map((s) => [s.symbol, s]));
  const rows: UpsideRow[] = [];
  for (const [sym, es] of Object.entries(file.names)) {
    const s = bySym.get(sym);
    if (!s) continue; // restrict to the current universe
    if (es.target == null || !es.price || (es.analysts ?? 0) < 3) continue; // need a real consensus
    const ri = recInfo(es.recKey, es.recMean);
    rows.push({
      symbol: sym,
      name: s.name,
      sector: s.sector,
      marketCap: s.marketCap,
      price: es.price,
      target: es.target,
      targetHigh: es.targetHigh ?? null,
      targetLow: es.targetLow ?? null,
      upsidePct: (es.target / es.price - 1) * 100,
      rangePct: es.targetHigh != null && es.targetLow != null && es.price ? ((es.targetHigh - es.targetLow) / es.price) * 100 : null,
      recLabel: ri.label,
      recTone: ri.tone,
      analysts: es.analysts ?? null,
    });
  }
  rows.sort((a, b) => b.upsidePct - a.upsidePct);

  const bySector = new Map<string, UpsideRow[]>();
  for (const r of rows) {
    if (!r.sector) continue;
    const l = bySector.get(r.sector);
    if (l) l.push(r);
    else bySector.set(r.sector, [r]);
  }
  const sectors: SectorUpside[] = [...bySector.entries()]
    .map(([sector, list]) => ({ sector, total: list.length, avgUpside: list.reduce((a, b) => a + b.upsidePct, 0) / list.length }))
    .sort((a, b) => b.avgUpside - a.avgUpside);

  return { rows, sectors, asOf: file.asOf, coverage: rows.length };
}
