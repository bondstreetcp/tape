/**
 * Staples Scanner — a biweekly NielsenIQ retail-scanner tracker, built by EXTRACTING the sell-side scan
 * notes (GS / Morgan Stanley / Wells Fargo NielsenIQ updates) into a structured per-company/category time
 * series. The tradeable read for consumer staples: US point-of-sale $ growth, volume/price split, and
 * SHARE momentum across L2wk/L4wk/L12wk/L52wk windows — a ~2-week-lagged leading indicator of the
 * quarterly print and the stock reaction (inflection + share gains/losses + category rotation).
 *
 * ⚠ LICENSING: the source PDFs are licensed sell-side research (private to the user). The extractor reads
 * them from a LOCAL watched folder that is NEVER committed (the repo is public); we persist only the
 * EXTRACTED numbers (derived data), never the copyrighted text, and this board is internal-only — do not
 * expose it on any public surface.
 *
 * PURE + client-safe: types + pure helpers only (no fs/network) so the view can import the helpers and the
 * script/page can import the types. The extractor lives in scripts/refresh-staples-scanner.ts; the page
 * reads data/staples-scanner.json.
 */

export type ScanLevel = "category" | "company" | "brand";
export type Inflection = "accelerating" | "stable" | "decelerating" | null;

/** $ sales growth (%) by trailing window — the shape every scan note reports ("X for L2wks vs Y/Z for 4/12wks"). */
export interface ScanWindows {
  l2w?: number | null;
  l4w?: number | null;
  l12w?: number | null;
  l52w?: number | null;
}

export interface ScanRow {
  level: ScanLevel;
  category: string; // "Beer", "Spirits", "CSD", "Energy", "Cigarettes", "Smokeless", "Beauty", "Oral Care", ...
  label: string; // company / brand / category name as written in the note
  ticker: string | null; // mapped US ticker when the row is a covered company; else null
  dollar: ScanWindows; // $ sales growth by window
  volume?: number | null; // latest-window volume growth %
  priceMix?: number | null; // latest-window price/mix %
  shareDeltaBps?: number | null; // y/y $-share change in bps (+ = gaining share)
  inflection?: Inflection; // accel/decel/stable (stated in the note, or derived via inflectionOf)
  note?: string | null; // one short takeaway line (our paraphrase — never a verbatim quote)
}

export interface ScanReport {
  source: string; // "GS" | "Morgan Stanley" | "Wells Fargo" | ...
  title: string; // the note's own title (short)
  segment: string; // "Alcohol" | "Tobacco" | "Non-Alc Beverages" | "Beauty & HPC" | "Staples Retail"
  periodEnd: string; // YYYY-MM-DD — the "data thru 8/8" date
  publishedAt: string; // report date, YYYY-MM-DD
  sourceFile: string; // the PDF basename it was extracted from (dedupe key; NOT the content)
  rows: ScanRow[];
}

// AI "desk read" of the whole board — generated once at extraction time (biweekly data, so no per-view
// LLM cost) and shown atop the Staples Scanner. Grounded ONLY in the extracted figures.
export interface ScanSummary {
  headline: string; // the single biggest takeaway, one sentence
  points: string[]; // 3-6 plain-English bullets: accel/decel names, share gainers/losers, category trends, setups into prints
  periodEnd: string; // the data-thru date this read covers
  generatedAt: string;
}

export interface StaplesScannerData {
  generatedAt: string;
  summary?: ScanSummary | null; // AI desk read of the current board (regenerated when new scans are extracted)
  reports: ScanReport[]; // most-recent periodEnd first; accretes into a time series as new notes are extracted
}

// Company name (lowercased) → US ticker, for the staples names these scans cover. Extend as coverage grows.
// ADRs where the name is foreign (Diageo/Haleon/BAT/etc.) so the stock pages still resolve a tradeable line.
export const STAPLES_TICKERS: Record<string, string> = {
  "coca-cola": "KO", coke: "KO", pepsico: "PEP", pepsi: "PEP", "keurig dr pepper": "KDP",
  monster: "MNST", celsius: "CELH", "primo brands": "PRMB", constellation: "STZ",
  "molson coors": "TAP", "brown-forman": "BF.B", "boston beer": "SAM",
  "anheuser-busch inbev": "BUD", "anheuser-busch": "BUD", abi: "BUD", "ab inbev": "BUD",
  altria: "MO", "philip morris": "PM", "british american tobacco": "BTI", bat: "BTI",
  "imperial brands": "IMBBY", imperial: "IMBBY", "japan tobacco": "JAPAY",
  diageo: "DEO", haleon: "HLN", reckitt: "RBGLY", unilever: "UL", "l'oreal": "LRLCY", "l'oréal": "LRLCY",
  beiersdorf: "BDRFY", campari: "DVCMY", pernod: "PDRDY", "pernod ricard": "PDRDY",
  kenvue: "KVUE", colgate: "CL", "kimberly-clark": "KMB", clorox: "CLX", "church & dwight": "CHD",
  "procter & gamble": "PG", "kraft heinz": "KHC", "general mills": "GIS", mondelez: "MDLZ", hershey: "HSY",
};

/** Map a company name to a US ticker (exact, then substring). Null for categories/brands/unknowns. */
export function tickerFor(name: string | null | undefined): string | null {
  const k = (name ?? "").toLowerCase().trim();
  if (!k) return null;
  if (STAPLES_TICKERS[k]) return STAPLES_TICKERS[k];
  for (const [n, t] of Object.entries(STAPLES_TICKERS)) if (k.includes(n)) return t;
  return null;
}

/** Inflection when the note doesn't state one: compare the near window (4wk, else 2wk) to the 12wk. */
export function inflectionOf(w: ScanWindows): Inflection {
  const near = w.l4w ?? w.l2w;
  const far = w.l12w;
  if (near == null || far == null) return null;
  const d = near - far;
  if (d > 0.5) return "accelerating";
  if (d < -0.5) return "decelerating";
  return "stable";
}

export const inflectionColor = (i: Inflection): string =>
  i === "accelerating" ? "#22c55e" : i === "decelerating" ? "#ef4444" : "var(--text-3)";

/** Growth color: green positive, red negative, muted near flat. */
export const growthColor = (v: number | null | undefined): string =>
  v == null ? "var(--text-4)" : v >= 1 ? "#22c55e" : v <= -1 ? "#ef4444" : "var(--text-3)";

export const fmtPct = (v: number | null | undefined): string => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

/** A single name's latest scanner read (its company-level row + the report it came from) — for the
 *  earnings-prep / desk-note tie-in: the ~2-week-lagged demand read on a staples name into its print. */
export interface ScannerRead {
  periodEnd: string;
  source: string;
  segment: string;
  row: ScanRow;
  deskRead: string | null; // the board-wide AI desk-read headline, so the aggregate takeaway travels with the name
}

/** Find a ticker's most-recent COMPANY-level scanner row across all reports. Null for non-covered names. */
export function latestScannerFor(data: StaplesScannerData | null, ticker: string | null | undefined): ScannerRead | null {
  const T = (ticker ?? "").toUpperCase();
  if (!data || !T) return null;
  let best: ScannerRead | null = null;
  for (const rep of data.reports ?? []) {
    for (const row of rep.rows ?? []) {
      if (row.level === "company" && row.ticker === T && (!best || (rep.periodEnd || "") > best.periodEnd)) {
        best = { periodEnd: rep.periodEnd, source: rep.source, segment: rep.segment, row, deskRead: data.summary?.headline ?? null };
      }
    }
  }
  return best;
}
