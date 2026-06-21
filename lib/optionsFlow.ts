import fs from "fs";
import path from "path";

export interface FlowEntry {
  symbol: string;
  name: string;
  underlying: number | null;
  chgPct: number | null; // underlying 1-day return (%)
  type: "call" | "put";
  strike: number;
  expiry: string | null;
  dte: number | null;
  vol: number;
  oi: number;
  volOI: number | null;
  premium: number; // $ value traded today (volume × mid × 100)
  iv: number | null;
  mid: number;
  unusual: boolean; // today's volume exceeds open interest
}

export interface OptionsFlow {
  generatedAt: string;
  universe: string;
  scanned: number;
  withOptions: number;
  totalFlows: number;
  callPremium: number;
  putPremium: number;
  entries: FlowEntry[];
}

let cache: OptionsFlow | null | undefined;

/** The committed market-wide options-flow snapshot (npm run refresh-flow). */
export function getOptionsFlow(): OptionsFlow | null {
  if (cache !== undefined) return cache;
  try {
    const p = path.join(process.cwd(), "data", "options-flow.json");
    cache = JSON.parse(fs.readFileSync(p, "utf8")) as OptionsFlow;
  } catch {
    cache = null;
  }
  return cache;
}
