/**
 * SERVER-ONLY reader for the attention/pageviews feed — split from lib/attention.ts (imported by the
 * client <AttentionPanel/>) so `fs`/`path` never reach the browser bundle. Read by the Economy page.
 */
import { promises as fsp } from "fs";
import path from "path";
import type { AttentionData } from "./attention";

/** Read the committed feed for the Economy page. null (never throws) when it hasn't been built yet. */
export async function getAttention(): Promise<AttentionData | null> {
  try {
    const raw = await fsp.readFile(path.join(process.cwd(), "data", "attention.json"), "utf8");
    const d = JSON.parse(raw) as AttentionData;
    return d && Array.isArray(d.items) ? d : null;
  } catch {
    return null;
  }
}
