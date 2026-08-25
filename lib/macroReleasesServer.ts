/**
 * SERVER-ONLY reader for the macro-releases feed — split out of lib/macroReleases.ts (which is imported
 * by the client MacroDashboard) so `fs`/`path` never reach the browser bundle. Read by the Macro page.
 */
import { promises as fsp } from "fs";
import path from "path";
import type { MacroRelease, MacroReleasesData } from "./macroReleases";

/** Read the committed feed for the Macro page. Empty (never throws) when the feed hasn't run yet. */
export async function getMacroReleases(limit = 16): Promise<MacroRelease[]> {
  try {
    const raw = await fsp.readFile(path.join(process.cwd(), "data", "macro-releases.json"), "utf8");
    const d = JSON.parse(raw) as MacroReleasesData;
    return (d.releases ?? [])
      .filter((r) => r && r.title && r.date)
      .sort((a, b) => Date.parse(b.date) - Date.parse(a.date))
      .slice(0, limit);
  } catch {
    return [];
  }
}
