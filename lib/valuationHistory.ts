/**
 * "Discount to own 10-year history" valuation screen. For each US name we rebuild a
 * point-in-time valuation-multiple series (P/E, EV/EBITDA, P/S, P/B) from SEC EDGAR
 * quarterly fundamentals + split-adjusted price history, then compare today's multiple
 * against the name's OWN trailing-10yr median. A multiple well below its own median is a
 * stock "on sale vs its history"; well above is rich.
 *
 * The series is built offline (scripts/refresh-valuation-history.ts → data/valuation-history.json)
 * because it's one EDGAR companyfacts pull + one price-history pull per name. This module owns the
 * types + a cached loader.
 *
 * Caveat: this is a name-relative gauge (current vs its own history), not an absolute "cheap" call —
 * a structurally-derating business can sit below its median for years. EPS/EBITDA can also be noisy
 * quarter to quarter, so we use the MEDIAN (not mean), winsorize tails, and require ≥8 valid quarters.
 */
import { promises as fsp } from "fs";
import path from "path";

export type MultipleKey = "pe" | "evEbitda" | "ps" | "pb";
export type SectorClass = "financial" | "non-financial";

export const MULTIPLE_LABELS: Record<MultipleKey, string> = {
  pe: "P/E",
  evEbitda: "EV/EBITDA",
  ps: "P/S",
  pb: "P/B",
};

export interface MultipleStat {
  current: number; // latest point-in-time multiple
  median: number; // trailing-10yr (≤40 quarter) median
  p25: number;
  p75: number;
  discountPct: number; // current/median − 1, in % (negative = cheap vs history)
  z: number; // (current − median) / stdev
  n: number; // number of valid quarters behind the stats
  series: [string, number][]; // ["YYYY-MM", value] … trailing ≤40 quarters, oldest→newest
}

export interface ValuationName {
  asOf: string; // latest price/quarter date used (YYYY-MM-DD)
  sectorClass: SectorClass;
  eligible: MultipleKey[]; // multiples we computed for this name (order = display priority)
  multiples: Partial<Record<MultipleKey, MultipleStat>>;
}

export interface ValuationHistoryData {
  generatedAt: string; // ISO timestamp the file was built
  asOf: string | null; // latest as-of date across all names
  names: Record<string, ValuationName>; // keyed by ticker
}

let _cache: Promise<ValuationHistoryData | null> | null = null;

export function loadValuationHistory(): Promise<ValuationHistoryData | null> {
  if (!_cache)
    _cache = fsp
      .readFile(path.join(process.cwd(), "data", "valuation-history.json"), "utf8")
      .then((s) => JSON.parse(s) as ValuationHistoryData)
      .catch(() => null);
  return _cache;
}
