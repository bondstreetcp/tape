/**
 * SERVER-ONLY reader for the economic-surprise ledger — split from lib/econSurprise.ts (imported by the
 * client <EconSurprisePanel/>) so `fs`/`path` never reach the browser bundle. Read by the Economy page.
 */
import { promises as fsp } from "fs";
import path from "path";
import type { EconSurpriseData } from "./econSurprise";

/** Read the committed ledger for the Economy page. null (never throws) when it hasn't been built yet. */
export async function getEconSurprise(): Promise<EconSurpriseData | null> {
  try {
    const raw = await fsp.readFile(path.join(process.cwd(), "data", "econ-surprises.json"), "utf8");
    const d = JSON.parse(raw) as EconSurpriseData;
    return d && Array.isArray(d.events) ? d : null;
  } catch {
    return null;
  }
}
