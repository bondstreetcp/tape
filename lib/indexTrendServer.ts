/**
 * SERVER-ONLY reader for the index trend-channel feed — split from lib/indexTrend.ts (imported by the
 * client <IndexTrendPanel/>) so `fs` never reaches the browser bundle. Read by the Macro page.
 */
import { promises as fsp } from "fs";
import path from "path";
import type { IndexTrendData } from "./indexTrend";

async function read(file: string): Promise<IndexTrendData | null> {
  try {
    const d = JSON.parse(await fsp.readFile(path.join(process.cwd(), "data", file), "utf8")) as IndexTrendData;
    return d && Array.isArray(d.indices) && d.indices.length ? d : null;
  } catch {
    return null;
  }
}

/** The index trend-channel feed for the Macro "Valuation" tab. null when not built yet. */
export const getIndexTrend = (): Promise<IndexTrendData | null> => read("index-trend.json");
/** The sector trend-channel feed (same shape), cheapest→dearest. null when not built yet. */
export const getSectorTrend = (): Promise<IndexTrendData | null> => read("sector-trend.json");
