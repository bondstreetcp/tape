/**
 * "Real economy" alt-data — free, primary-source freight / travel / housing indicators that lead the
 * hard macro prints. CLIENT-SAFE: types + presentation helpers only (no fs), imported by
 * <RealEconomyPanel/>. The feed is built by scripts/refresh-real-economy.ts and read server-side by
 * lib/realEconomyServer.ts.
 *
 * Sources (all free, no license): FRED (fredgraph, keyless) for the monthly index series, and TSA's
 * public checkpoint-throughput page for daily air-travel demand. Hotel is a lodging-CPI PROXY, NOT STR
 * RevPAR (which is licensed) — labeled as such everywhere it renders.
 */
export type RealEcoGroup = "Freight" | "Travel" | "Housing";

export interface RealEcoSeries {
  key: string;
  label: string;
  group: RealEcoGroup;
  unit: string; // human unit for the value, e.g. "carloads/mo", "index", "k units SAAR", "$B SAAR"
  seriesId: string; // FRED id (provenance)
  latest: number | null;
  latestDate: string | null; // period end (YYYY-MM-DD)
  prev: number | null; // prior period (for MoM)
  yearAgo: number | null; // ~12mo prior (for YoY)
  momPct: number | null;
  yoyPct: number | null;
  history: [string, number][]; // [date, value], trimmed oldest→newest, for a sparkline
  source: string;
  note?: string; // caveat shown inline (proxy disclosures)
}

export interface TsaThroughput {
  latestDate: string | null; // most recent day (M/D/YYYY normalized to YYYY-MM-DD)
  latest: number | null; // passengers that day
  avg7: number | null; // trailing 7-day average
  prev7: number | null; // 7-day avg ~1 month earlier
  chg30dPct: number | null; // avg7 vs prev7 — near-term momentum (the page is YTD-only, so no true YoY)
  history: [string, number][]; // last ~120 days [date, passengers]
  source: string;
}

export interface RealEconomyRead {
  tldr: string; // one-line synthesis
  regime: "expanding" | "cooling" | "mixed" | "contracting"; // the overall read
  points: string[]; // 2-4 plain-English observations
  readThrough?: string[]; // sector/ticker read-throughs
  caveat?: string;
  generatedAt: string;
}

export interface RealEconomyData {
  asOf: string;
  series: RealEcoSeries[];
  tsa: TsaThroughput | null;
  read?: RealEconomyRead | null; // baked AI desk read (regenerates when a monthly series prints)
}

export const REGIME_COLOR: Record<RealEconomyRead["regime"], string> = {
  expanding: "#22c55e",
  cooling: "#f59e0b",
  mixed: "var(--text-2)",
  contracting: "#ef4444",
};

export const GROUP_ORDER: RealEcoGroup[] = ["Freight", "Travel", "Housing"];

/** Compact number for display: 1,006,056 → "1.01M", 2,166,539 → "2.17M", 1239 → "1,239". */
export function fmtVal(v: number | null, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (/\$M/.test(unit)) return `$${(v / 1_000).toFixed(1)}B`; // construction spend is $M SAAR → show $B
  if (Math.abs(v) >= 1_000_000) return `${(v / 1_000_000).toFixed(2)}M`;
  if (Math.abs(v) >= 100_000) return `${(v / 1_000).toFixed(0)}k`;
  return v.toLocaleString("en-US", { maximumFractionDigits: 1 });
}

export const pctColor = (v: number | null): string => (v == null ? "var(--text-3)" : v >= 0 ? "#22c55e" : "#ef4444");
export const fmtPct = (v: number | null): string => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);
