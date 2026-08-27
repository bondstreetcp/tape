/**
 * Economic Surprise Index — a free, self-built Citi-ESI-style read on how US data is printing vs the
 * consensus. We already have both halves: consensus economist forecasts (ForexFactory, via
 * lib/econEstimates) and the actual prints (FRED, via the macro snapshot's ReleaseData). For each
 * release we standardize the surprise (actual − consensus, divided by a typical-surprise scale, with
 * the sign flipped where "more" = weaker, e.g. jobless claims) and accumulate a ledger; the index is a
 * time-decayed sum of the trailing ~90 days of standardized surprises. Positive = data mostly beating.
 *
 * The ledger accretes as releases print (it starts light and fills in), so it's stored and merged each
 * refresh rather than recomputed from scratch. CLIENT-SAFE: types + helpers only (no fs/network). Built
 * by scripts/refresh-econ-surprise.ts, rendered by <EconSurprisePanel/>. Decision-support, not advice.
 */
export type SurpriseCategory = "Growth" | "Inflation" | "Labor" | "Housing" | "Consumer";

export interface SurpriseEvent {
  key: string;
  label: string;
  category: SurpriseCategory;
  date: string; // the print's date (YYYY-MM-DD)
  actual: number;
  consensus: number;
  unit: string;
  z: number; // standardized surprise; sign = economic direction (positive = stronger-than-expected)
}

export interface EconSurpriseData {
  asOf: string;
  startedDate: string; // when the ledger began accreting (for the honest "fills in over time" note)
  events: SurpriseEvent[]; // full ledger, oldest→newest
  index: [string, number][]; // the ESI time-series [date, value], oldest→newest
  latest: number | null; // most recent ESI value
}

// Per-release: category, the ~1σ surprise magnitude (native units) used to standardize, and whether a
// higher-than-expected print is economically WEAKER (invert the sign so the index reads stronger↑).
export const SURPRISE_CFG: Record<string, { category: SurpriseCategory; scale: number; invert?: boolean }> = {
  payrolls: { category: "Labor", scale: 70 }, // ±70K is a big NFP surprise
  claims: { category: "Labor", scale: 15, invert: true }, // more claims = weaker
  jolts: { category: "Labor", scale: 0.35 },
  cpi: { category: "Inflation", scale: 0.15 },
  ppi: { category: "Inflation", scale: 0.25 },
  pce: { category: "Inflation", scale: 0.12 },
  gdp: { category: "Growth", scale: 0.6 },
  retail: { category: "Growth", scale: 0.4 },
  indpro: { category: "Growth", scale: 0.35 },
  durable: { category: "Growth", scale: 1.5 },
  housing: { category: "Housing", scale: 0.06 },
  sentiment: { category: "Consumer", scale: 2.5 },
};

export const CATEGORY_COLOR: Record<SurpriseCategory, string> = {
  Growth: "#60a5fa",
  Inflation: "#f59e0b",
  Labor: "#22c55e",
  Housing: "#a855f7",
  Consumer: "#ec4899",
};

/** Parse a ForexFactory value string ("150K", "2.7%", "1.43M", "-0.2%") to a number in the release's
 *  own units — the suffix is dropped because each release's consensus already matches its actual's unit. */
export function parseFFValue(s: string | null | undefined): number | null {
  if (!s) return null;
  const m = String(s).replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? parseFloat(m[0]) : null;
}

/** Colour a standardized surprise / index value: beats green, misses red, ~flat grey. */
export function surpriseColor(v: number | null): string {
  if (v == null || Math.abs(v) < 0.15) return "var(--text-3)";
  return v > 0 ? "#22c55e" : "#ef4444";
}

export function fmtZ(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)}σ`;
}

/** A signed value in the release's units, for the actual/consensus table. */
export function fmtVal(v: number | null, unit: string): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const d = Math.abs(v) >= 100 ? 0 : Math.abs(v) >= 10 ? 1 : 2;
  const suff = unit === "%" ? "%" : unit === "K" ? "K" : unit === "M" ? "M" : "";
  return `${v.toFixed(d)}${suff}`;
}

export function beatMiss(z: number): string {
  if (Math.abs(z) < 0.15) return "in line";
  return z > 0 ? "beat" : "miss";
}
