/**
 * Energy dashboard — a real-economy read on the oil & gas complex. Two halves:
 *   • Prices (keyless, always on) — WTI, Brent, Henry Hub, and US retail gasoline & diesel, from FRED.
 *   • The EIA weekly balance (needs a free EIA_API_KEY) — crude/gasoline/distillate inventories + a
 *     lower-48 natural-gas storage read (with the weekly build/draw and level vs its 5-yr seasonal
 *     norm), plus supply & demand (US crude production, refinery utilization, and product supplied =
 *     implied demand).
 *
 * CLIENT-SAFE: types + formatting helpers only (no fs/network). Built by scripts/refresh-energy.ts,
 * rendered by <EnergyPanel/>. Decision-support, not advice.
 */
export type EnergyGroup = "Prices" | "Inventories" | "Supply & demand";

export interface EnergySeries {
  key: string;
  label: string;
  group: EnergyGroup;
  unit: string; // "$/bbl", "$/gal", "$/MMBtu", "M bbl", "M bbl/d", "%", "Bcf"
  latest: number | null;
  latestDate: string | null;
  wow: number | null; // week-over-week change in `unit` (for inventories this is the build/draw)
  wowPct: number | null; // week-over-week % (for prices)
  yoyPct: number | null; // year-over-year %
  vsSeasonalPct: number | null; // level vs the ~5-yr seasonal norm for this time of year (inventories)
  history: [string, number][]; // [date, value] oldest→newest
  source: "FRED" | "EIA";
  signMode?: "goodUp" | "goodDown"; // colour the change; absent = neutral (energy prices/levels)
  note?: string;
}

export interface EnergyData {
  asOf: string;
  eiaConfigured: boolean; // was EIA_API_KEY present when the feed was built?
  series: EnergySeries[];
}

export const ENERGY_GROUP_ORDER: EnergyGroup[] = ["Prices", "Inventories", "Supply & demand"];

/** Format a level for its unit. */
export function fmtEnergy(v: number | null, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const d =
    unit === "$/gal" || unit === "$/MMBtu" ? 2 :
    unit === "$/bbl" ? 1 :
    unit === "%" ? 1 :
    Math.abs(v) >= 1000 ? 0 : Math.abs(v) >= 100 ? 0 : 1;
  return v.toLocaleString("en-US", { minimumFractionDigits: d, maximumFractionDigits: d });
}

/** Signed change, formatted for its unit (e.g. inventory build/draw "+3.2 M bbl"). */
export function fmtChange(v: number | null, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const s = v > 0 ? "+" : v < 0 ? "−" : "";
  const a = Math.abs(v);
  const d = a >= 100 ? 0 : a >= 10 ? 1 : 2;
  const u = unit === "M bbl" ? " M bbl" : unit === "Bcf" ? " Bcf" : unit === "M bbl/d" ? " M b/d" : unit === "%" ? " pp" : "";
  return `${s}${a.toFixed(d)}${u}`;
}

export function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(1)}%`;
}

/** Colour a change given the series' sign convention. Neutral (grey) when signMode is absent. */
export function changeColor(v: number | null, signMode?: "goodUp" | "goodDown"): string {
  if (v == null || v === 0 || !signMode) return "var(--text-3)";
  const good = signMode === "goodUp" ? v > 0 : v < 0;
  return good ? "#22c55e" : "#ef4444";
}

/** A build/draw label for inventory series (positive = build). */
export function buildDraw(v: number | null): string {
  if (v == null || v === 0) return "flat";
  return v > 0 ? "build" : "draw";
}

/** Plain up/down tint for prices (informational, not good/bad). */
export function tintColor(v: number | null): string {
  if (v == null || v === 0) return "var(--text-3)";
  return v > 0 ? "#22c55e" : "#ef4444";
}

export const ENERGY_TOOLTIPS: Record<string, string> = {
  wti: "West Texas Intermediate — the US benchmark crude price (FRED/EIA, daily).",
  brent: "Brent — the international benchmark crude price (FRED/EIA, daily).",
  henryhub: "Henry Hub — the US benchmark natural-gas spot price, $/MMBtu (FRED/EIA, daily).",
  gasoline: "US average retail price of regular gasoline, $/gallon (FRED/EIA, weekly) — a direct read on consumer energy costs.",
  diesel: "US average retail price of on-highway diesel, $/gallon (FRED/EIA, weekly) — a freight-cost and goods-inflation read.",
  crudeStocks: "Commercial crude-oil inventories (ex-SPR), million barrels. The weekly build/draw is the number oil traders watch; 'vs seasonal' compares the level to its ~5-yr norm for this time of year (EIA Weekly Petroleum Status Report).",
  gasStocks: "Total motor-gasoline inventories, million barrels — a demand/supply balance read into driving season (EIA weekly).",
  distStocks: "Distillate (diesel/heating-oil) inventories, million barrels — a tightness read for freight & industry (EIA weekly).",
  ngStorage: "Working natural gas in underground storage, lower-48, Bcf. The weekly injection/withdrawal + level vs the 5-yr band drives gas prices (EIA weekly).",
  crudeProd: "US crude-oil field production, million barrels/day — the domestic supply trend (EIA weekly estimate).",
  refUtil: "Refinery utilization — % of operable capacity in use. High utilization = strong throughput/activity (EIA weekly).",
  prodSupplied: "Total petroleum products supplied — EIA's proxy for total US oil DEMAND, million barrels/day (EIA weekly).",
  gasSupplied: "Finished motor-gasoline product supplied — implied gasoline demand, million barrels/day (EIA weekly).",
  distSupplied: "Distillate product supplied — implied diesel/heating-oil demand, million barrels/day (EIA weekly).",
};
