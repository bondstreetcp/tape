/**
 * SERVER-ONLY reader for the CFTC COT positioning feed — split from lib/cot.ts (imported by the client
 * <CotPanel/>) so `fs`/`path` never reach the browser bundle. Read by the Economy (Macro) page.
 */
import { promises as fsp } from "fs";
import path from "path";
import type { CotData } from "./cot";

/** Read the committed feed for the Economy page. null (never throws) when it hasn't been built yet. */
export async function getCot(): Promise<CotData | null> {
  try {
    const raw = await fsp.readFile(path.join(process.cwd(), "data", "cot.json"), "utf8");
    const d = JSON.parse(raw) as CotData;
    return d && Array.isArray(d.rows) ? d : null;
  } catch {
    return null;
  }
}
