/**
 * SERVER-ONLY reader for the real-economy alt-data feed — split from lib/realEconomy.ts (imported by
 * the client <RealEconomyPanel/>) so `fs`/`path` never reach the browser bundle. Read by the Macro page.
 */
import { promises as fsp } from "fs";
import path from "path";
import type { RealEconomyData } from "./realEconomy";

/** Read the committed feed for the Macro page. null (never throws) when it hasn't been built yet. */
export async function getRealEconomy(): Promise<RealEconomyData | null> {
  try {
    const raw = await fsp.readFile(path.join(process.cwd(), "data", "real-economy.json"), "utf8");
    const d = JSON.parse(raw) as RealEconomyData;
    return d && Array.isArray(d.series) ? d : null;
  } catch {
    return null;
  }
}
