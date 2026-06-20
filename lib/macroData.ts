import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { getMacro, type Macro } from "./fred";

/**
 * Macro data for the page: prefer the committed snapshot (data/macro.json,
 * refreshed by `npm run refresh-macro`) so the page doesn't depend on a live
 * FRED fetch at request time — those fail from some serverless hosts, which left
 * the dashboard empty in production. Falls back to a live fetch when the snapshot
 * is missing or stale.
 */
export async function getMacroCached(): Promise<Macro> {
  try {
    const p = join(process.cwd(), "data", "macro.json");
    if (existsSync(p)) {
      const m = JSON.parse(readFileSync(p, "utf8")) as Macro;
      if (m?.curve?.some((c) => c.now != null)) return m;
    }
  } catch {
    /* fall through to live fetch */
  }
  return getMacro();
}
