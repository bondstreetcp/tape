/**
 * CFTC Commitments of Traders (COT) — free weekly futures positioning from the CFTC public API. Tracks
 * large speculators (non-commercials, "managed money"-ish) vs commercials (hedgers) across the key
 * equity-index, rate, FX, energy, metal & ag contracts. The signal is CROWDING: when specs' net
 * position sits at a 5-year extreme, it's contrarian (crowded long = vulnerable to a squeeze lower).
 *
 * CLIENT-SAFE: types + helpers only (no fs/network). Built by scripts/refresh-cot.ts, rendered by
 * <CotView/>. Decision-support, not advice.
 */
export type CotGroup = "Equities" | "Rates" | "FX" | "Energy" | "Metals" | "Ags" | "Crypto";

export interface CotRow {
  key: string;
  label: string;
  group: CotGroup;
  specNet: number; // non-commercial net (long − short) — large speculators
  specNetPrev: number; // prior week
  wowChange: number; // specNet − specNetPrev
  pctOI: number | null; // specNet as % of open interest
  percentile: number; // 0–100 — where the latest net sits in its ~5yr range (100 = most-long ever, 0 = most-short)
  commNet: number; // commercial net (hedgers — the other side)
  openInterest: number;
  history: [string, number][]; // [date, specNet] oldest→newest, for a sparkline
}

export interface CotData {
  asOf: string;
  reportDate: string; // the COT "as of" Tuesday
  rows: CotRow[];
}

export const COT_GROUP_ORDER: CotGroup[] = ["Equities", "Rates", "FX", "Energy", "Metals", "Ags", "Crypto"];

/** Compact contract count: 123456 → "123k", 1234567 → "1.2M". */
export function fmtContracts(v: number): string {
  const a = Math.abs(v), sign = v < 0 ? "−" : "";
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)}k`;
  return `${sign}${a}`;
}

/** A percentile → its crowding read + colour. Extreme either end is the signal. */
export function crowding(p: number): { label: string; color: string } {
  if (p >= 90) return { label: "crowded long", color: "#ef4444" };
  if (p >= 75) return { label: "net long", color: "#f59e0b" };
  if (p <= 10) return { label: "crowded short", color: "#22c55e" };
  if (p <= 25) return { label: "net short", color: "#22c55e" };
  return { label: "neutral", color: "var(--text-3)" };
}
