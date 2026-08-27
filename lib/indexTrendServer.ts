/**
 * SERVER-ONLY reader for the index trend-channel feed — split from lib/indexTrend.ts (imported by the
 * client <IndexTrendPanel/>) so `fs` never reaches the browser bundle. Read by the Macro page.
 */
import { promises as fsp } from "fs";
import path from "path";
import type { IndexTrendData } from "./indexTrend";

/** Read the committed feed for the Macro "Valuation" tab. null (never throws) when not built yet. */
export async function getIndexTrend(): Promise<IndexTrendData | null> {
  try {
    const raw = await fsp.readFile(path.join(process.cwd(), "data", "index-trend.json"), "utf8");
    const d = JSON.parse(raw) as IndexTrendData;
    return d && Array.isArray(d.indices) && d.indices.length ? d : null;
  } catch {
    return null;
  }
}
