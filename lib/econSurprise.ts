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
  date: string; // the RELEASE date (YYYY-MM-DD) — when the surprise hit the tape; drives the time-decay
  actual: number;
  consensus: number;
  unit: string;
  z: number; // standardized surprise; sign = economic direction (positive = stronger-than-expected)
  obs?: string; // FRED observation/reference date — the STABLE print identity for dedup (differs from
                // `date` for monthly releases, whose reference month precedes the release by weeks)
}

/** Stable identity for de-duping the ledger across refreshes. Older events (pre-`obs`) stored the
 *  reference date in `date`, so they fall back to it — keeping identity continuous through the schema bump. */
export const surpriseIdOf = (e: SurpriseEvent): string => `${e.key}|${e.obs ?? e.date}`;

/** Standardize a surprise into a clamped z-score: (actual − consensus) / typical-scale, sign flipped
 *  where a higher print is economically weaker (e.g. jobless claims). Returns null for an unknown key. */
export function standardizeSurprise(key: string, actual: number, consensus: number): number | null {
  const cfg = SURPRISE_CFG[key];
  if (!cfg) return null;
  const raw = ((actual - consensus) / cfg.scale) * (cfg.invert ? -1 : 1);
  return Math.round(Math.max(-3, Math.min(3, raw)) * 100) / 100;
}

/** Guard against scoring a YoY actual against an m/m consensus (or vice versa): when ForexFactory carries
 *  only the "wrong" metric for a release, our actual (fixed by the release's transform) and their forecast
 *  are in different units and the surprise is nonsense. Only an explicit y/y↔m/m contradiction is rejected;
 *  level releases whose FF title names neither (claims, sentiment, housing, jobs) always pass. */
export function metricConsistent(transform: string, ffTitle: string | null | undefined): boolean {
  const title = ffTitle ?? "";
  const titleYoY = /y\/y/i.test(title), titleMoM = /m\/m/i.test(title);
  if (transform === "yoy" && titleMoM && !titleYoY) return false;
  if ((transform === "mom" || transform === "momChange") && titleYoY && !titleMoM) return false;
  return true;
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
