/**
 * "Recent economic releases" — the actual, just-published macro prints from the PRIMARY sources,
 * free and keyless: BEA (GDP, PCE / personal income, trade) and BLS (CPI, PPI, jobs, ECI, …). This is
 * the closest free stand-in for a paid headline wire's macro flashes: BEA/BLS publish the release
 * headline at the release instant (8:30 ET), often before FRED's series even updates.
 *
 * Complements — does NOT duplicate — the existing pieces: lib/econCalendar.ts is UPCOMING release
 * DATES (FRED, needs a key); lib/fred.ts / releases are the NUMBER HISTORY; refresh-fed.ts is FOMC
 * comms. This is the "it just printed" headline. Populated by scripts/refresh-macro-releases.ts.
 */
import { promises as fsp } from "fs";
import path from "path";

export type MacroSource = "BEA" | "BLS";
export type MacroCategory = "Growth" | "Inflation" | "Labor" | "Trade" | "Income" | "Other";

export interface MacroRelease {
  source: MacroSource;
  title: string; // "GDP (Advance Estimate), 2nd Quarter 2026" · "CPI: +0.1% in Jul 2026"
  url: string;
  date: string; // ISO — the release/update time
  category: MacroCategory;
  value?: string | null; // BLS only: the printed figure, e.g. "+0.1% in Jul 2026"
}

export interface MacroReleasesData {
  generatedAt: string;
  releases: MacroRelease[];
}

/** Bucket a release by its headline text — first match wins. */
export function catOf(title: string): MacroCategory {
  const t = title.toLowerCase();
  if (/\bpce\b|personal income|outlays|personal spending/.test(t)) return "Income";
  if (/\bcpi\b|\bppi\b|consumer price|producer price|price index|inflation/.test(t)) return "Inflation";
  if (/employ|payroll|unemployment|jobless|jolts|hourly earnings|\beci\b|employment cost|wage|labor/.test(t)) return "Labor";
  if (/\bgdp\b|gross domestic|productivity|industrial production/.test(t)) return "Growth";
  if (/trade|import price|export price|current account/.test(t)) return "Trade";
  return "Other";
}

export const CATEGORY_COLOR: Record<MacroCategory, string> = {
  Growth: "#22c55e",
  Inflation: "#ef4444",
  Labor: "#3b82f6",
  Trade: "#a855f7",
  Income: "#f59e0b",
  Other: "#8b93a7",
};

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
