import { promises as fs } from "fs";
import path from "path";
import type { Snapshot, StockSeries } from "./types";
import { symbolFile } from "./symbolfile";

const DATA_DIR = path.join(process.cwd(), "data");

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
