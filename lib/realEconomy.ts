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
export type RealEcoGroup = "Manufacturing" | "Freight" | "Consumer" | "Travel" | "Housing";

export interface RealEcoSeries {
  key: string;
  label: string;
  group: RealEcoGroup;
  unit: string; // human unit for the value, e.g. "carloads/mo", "index", "k units SAAR", "$B SAAR"
  changeUnit?: "%" | "pts"; // "pts" for diffusion indices (a point move, not a % — a % change of a survey index is meaningless)
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

export const GROUP_ORDER: RealEcoGroup[] = ["Manufacturing", "Freight", "Consumer", "Travel", "Housing"];

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
/** A change value with its unit — "+3.2%" for levels, "+3.2 pts" for diffusion-index surveys. */
export const fmtChange = (v: number | null, unit: "%" | "pts" = "%"): string =>
  v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}${unit === "pts" ? " pts" : "%"}`;

/** Hover explanations for each series (keyed by RealEcoSeries.key), + TSA. Presentation, not data. */
export const SERIES_TOOLTIPS: Record<string, string> = {
  // Manufacturing
  "pmi-empire": "Empire State Manufacturing Survey (NY Fed) — a diffusion index: the net % of factories reporting expansion vs contraction. >0 = expanding, <0 = contracting; the month-to-month POINT move is the signal. A free, timely stand-in for the licensed ISM PMI.",
  "pmi-philly": "Philadelphia Fed Manufacturing Survey — a diffusion index (net % of firms expanding). >0 = expanding; watch the point move. Free ISM-PMI stand-in.",
  "pmi-dallas": "Dallas Fed Manufacturing Survey — a diffusion index (net % of firms expanding). >0 = expanding; watch the point move. Free ISM-PMI stand-in.",
  "industrial-production": "Federal Reserve Industrial Production index (2017 = 100) — the real output of US factories, mines and utilities. The core HARD measure of manufacturing output.",
  "capacity-util": "Capacity utilization (%, Federal Reserve) — how much of the economy's productive capacity is actually in use. High = tight (potential price pressure); falling = slack building.",
  // Freight
  "rail-carloads": "US rail carloads (AAR, seasonally adjusted) — bulk goods moved by rail: coal, chemicals, grain, autos, metals. A read on heavy-industry & commodity freight demand.",
  "rail-intermodal": "US rail intermodal units (AAR, SA) — containers & trailers on rail, mostly consumer & imported goods. Tracks the retail/import goods pipeline.",
  "truck-freight-tsi": "BTS Freight Transportation Services Index — the US GOVERNMENT's index of for-hire freight VOLUME across all modes (trucking-dominated), monthly since 2000. Free public stand-in for the proprietary ATA Truck Tonnage Index. Modeled from carrier output data.",
  "cass-shipments": "Cass Freight Index — SHIPMENTS: the number of freight shipments Cass Information Systems processes for its North American shipper clients — a PRIVATE, real-invoice sample across all modes (rebased 1990 = 100). Vs the BTS index: Cass is transaction-based (actual freight bills, more timely, North America, truckload-heavy), while BTS is a government model of US for-hire output — the two corroborate each other.",
  "cass-expenditures": "Cass Freight Index — EXPENDITURES: total freight SPEND (shipments × rate) from Cass's invoice data (1990 = 100). Because it includes freight-RATE inflation, Expenditures ÷ Shipments is a proxy for freight rates — rising expenditures while shipments fall = higher rates.",
  // Consumer
  "retail-sales": "Advance monthly retail & food-services sales (Census Bureau, SAAR $) — the headline read on consumer spending.",
  "durable-goods": "New orders for manufactured durable goods (Census, SAAR $) — big-ticket items (machinery, aircraft, autos). A forward read on business & consumer investment demand.",
  // Travel
  "hotel-lodging-cpi": "CPI for lodging away from home (hotels/motels, BLS) — a PRICE proxy for hotels: it captures room-price inflation, NOT occupancy or revenue. Real RevPAR is STR/CoStar-licensed and isn't free.",
  // Housing
  "housing-starts": "New privately-owned housing units STARTED, annualized (SAAR, Census) — a read on residential construction breaking ground.",
  "building-permits": "New housing units AUTHORIZED by building permits (SAAR, Census) — leads housing starts, since permits come before ground-breaking.",
  "construction-spend": "Total US construction spending, residential + non-residential (SAAR, Census) — the broad construction-activity gauge.",
  // TSA (keyed separately)
  tsa: "TSA airport checkpoint throughput — daily count of US air passengers screened. A real-time DEMAND proxy for air travel (not load factor). The TSA page is year-to-date only, so there's no true year-over-year — the 'vs 1mo' is near-term momentum.",
};
