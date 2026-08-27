/**
 * SERVER-ONLY reader for the energy feed — split from lib/energy.ts (imported by the client
 * <EnergyPanel/>) so `fs`/`path` never reach the browser bundle. Read by the Economy (Macro) page.
 */
import { promises as fsp } from "fs";
import path from "path";
import type { EnergyData } from "./energy";

/** Read the committed feed for the Economy page. null (never throws) when it hasn't been built yet. */
export async function getEnergy(): Promise<EnergyData | null> {
  try {
    const raw = await fsp.readFile(path.join(process.cwd(), "data", "energy.json"), "utf8");
    const d = JSON.parse(raw) as EnergyData;
    return d && Array.isArray(d.series) ? d : null;
  } catch {
    return null;
  }
}
