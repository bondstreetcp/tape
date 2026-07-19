import { promises as fs } from "fs";
import path from "path";
import type { Snapshot, StockSeries } from "./types";
import type { Daily } from "./pairs";
import { symbolFile } from "./symbolfile";

const DATA_DIR = path.join(process.cwd(), "data");

/** The market (^GSPC) daily [ts,price] series, persisted by refresh-betas. null if not built yet. */
export async function loadMarketSeries(): Promise<Daily | null> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, "market.json"), "utf8");
    const j = JSON.parse(raw) as { daily?: Daily };
    return Array.isArray(j.daily) && j.daily.length ? j.daily : null;
  } catch {
    return null;
  }
}

export interface EtfMeta { name: string; price: number; beta: number | null; returns?: Record<string, number | null> }

/** Hedge-menu ETF price + beta (refresh-hedge-etfs) so /api/portfolio can price ETFs. {} if not built. */
export async function loadEtfMeta(): Promise<Record<string, EtfMeta>> {
  try {
    const raw = await fs.readFile(path.join(DATA_DIR, "etf-meta.json"), "utf8");
    return ((JSON.parse(raw) as { etfs?: Record<string, EtfMeta> }).etfs ?? {});
  } catch {
    return {};
  }
}

export async function loadSnapshot(universe: string): Promise<Snapshot | null> {
  try {
    const raw = await fs.readFile(
      path.join(DATA_DIR, universe, "snapshot.json"),
      "utf8",
    );
    return JSON.parse(raw) as Snapshot;
  } catch {
    return null;
  }
}

export async function loadSymbolSeries(
  symbol: string,
): Promise<StockSeries | null> {
  try {
    const raw = await fs.readFile(
      path.join(DATA_DIR, "series", "symbols", symbolFile(symbol)),
      "utf8",
    );
    return JSON.parse(raw) as StockSeries;
  } catch {
    return null;
  }
}

export async function loadManySymbolSeries(
  symbols: string[],
): Promise<Record<string, StockSeries>> {
  const entries = await Promise.all(
    symbols.map(async (s) => [s, await loadSymbolSeries(s)] as const),
  );
  const out: Record<string, StockSeries> = {};
  for (const [s, series] of entries) if (series) out[s] = series;
  return out;
}
