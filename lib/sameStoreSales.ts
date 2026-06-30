/**
 * Same-store / comparable sales (a.k.a. SSS, identical sales, like-for-like) — a company-disclosed
 * operating KPI that no financials API carries and that has no standard us-gaap XBRL tag. We extract
 * it from the 8-K earnings press release (Exhibit 99.1) with an LLM (see scripts/refresh-sss.ts) and
 * surface a comp-% trend row on the income statement for restaurants/retailers.
 *
 * CLIENT-SAFE: types + the eligible-industry Set + the pure period-matcher only. NO fs/llm/edgar here
 * (FinancialsView is a client component and imports compFinder + the types). The fs reader lives in
 * the stock page; the extractor lives in the refresh script.
 */
import type { FinPeriod } from "./financials";

export interface SssSource {
  form: string; // 8-K (or 10-Q fallback)
  url: string;
  date: string; // filing date
  quote: string | null; // verbatim disclosure sentence / table fragment (null if none citable)
}

export interface SssPeriod {
  fpEnd: string; // fiscal period-END date (ISO) — the JOIN KEY to the income statement's columns
  fiscalLabel?: string; // issuer's own label, e.g. "Q1 FY27"
  comp: number | null; // headline 1-yr total-company comparable-sales %, signed; null = checked, none disclosed
  basis?: string; // 1yr | 2yr-stack | ex-fx | reported — only 1yr feeds the row
  metricLabel?: string; // company's verbatim term, e.g. "Comparable restaurant sales"
  definition?: string | null; // disclosed measurement rule
  traffic?: number | null; // transactions/traffic comp
  ticket?: number | null; // average check / ticket / AUR comp
  segments?: { name: string; comp: number }[]; // by brand/banner/region
  twoYrStack?: number | null; // 2-year stacked comp (display-only)
  source: SssSource;
  confidence?: "high" | "medium" | "low";
}

export interface SssTicker {
  metricLabel: string;
  definition?: string | null;
  lastAccession?: string; // newest earnings filing seen → the new-quarter gate
  industry?: string;
  periods: SssPeriod[]; // newest → oldest
}

export interface SssData {
  generatedAt: string;
  byTicker: Record<string, SssTicker>;
}

/** GICS industries that report a comparable-/same-store-/like-for-like sales metric.
 *  Labels match lib/industryMap.ts. Phase 1 ships restaurants; the rest are wired for Phase 2. */
export const SSS_INDUSTRIES = new Set<string>([
  "Restaurants",
  "Apparel Retail",
  "Specialty Retail",
  "Other Specialty Retail",
  "Computer & Electronics Retail",
  "Department Stores",
  "Home Improvement Retail",
  "Automotive Retail",
  "Footwear",
  "Food Retail",
  "Grocery Stores",
  "Consumer Staples Merchandise Retail",
  "Discount Stores",
  "Broadline Retail",
  "Apparel, Accessories & Luxury Goods",
  "Luxury Goods",
]);

const DAY = 86_400_000;

/**
 * Resolve an income-statement period to its comparable-sales datum by matching the fiscal
 * period-END within ±25 days — tolerant of 52/53-week and 4-4-5 retail calendars and the usual
 * Yahoo/EDGAR date drift. Returns a closure so FinancialsView can map it over its columns.
 */
// ── Comps Board (cross-universe ranking) ─────────────────────────────────────────────────────────
export interface CompRow {
  ticker: string;
  name: string;
  industry: string;
  comp: number; // latest 1-yr comp %
  fpEnd: string;
  fiscalLabel?: string;
  priorComp: number | null; // the immediately prior quarter's comp
  seqDelta: number | null; // latest − prior → accelerating / decelerating
  twoYrStack: number | null; // latest + the comp ~1yr earlier (the "stacked" comp)
  traffic: number | null;
  ticket: number | null;
  metricLabel: string;
  sourceUrl: string;
}

const YR = 86_400_000;
/** Rank the comps universe by the latest quarterly comp. `nameOf`/`indOf` resolve display fields from
 *  a snapshot (kept out of this client-safe lib). */
export function buildCompsRows(data: SssData, nameOf: (t: string) => string | undefined): CompRow[] {
  const rows: CompRow[] = [];
  for (const [ticker, tk] of Object.entries(data.byTicker)) {
    const withComp = tk.periods.filter((p) => p.comp != null);
    if (!withComp.length) continue;
    const latest = withComp[0];
    const prior = withComp[1] ?? null;
    // 2-yr stack: the comp from ~1 year (≈4 quarters) before the latest period-end.
    const yrAgo = withComp.find((p) => {
      const d = (Date.parse(latest.fpEnd) - Date.parse(p.fpEnd)) / YR;
      return d > 300 && d < 430;
    });
    rows.push({
      ticker,
      name: nameOf(ticker) || ticker,
      industry: tk.industry || "",
      comp: latest.comp as number,
      fpEnd: latest.fpEnd,
      fiscalLabel: latest.fiscalLabel,
      priorComp: prior?.comp ?? null,
      seqDelta: prior?.comp != null ? (latest.comp as number) - prior.comp : null,
      twoYrStack: yrAgo?.comp != null ? (latest.comp as number) + yrAgo.comp : null,
      traffic: latest.traffic ?? null,
      ticket: latest.ticket ?? null,
      metricLabel: tk.metricLabel,
      sourceUrl: latest.source.url,
    });
  }
  return rows.sort((a, b) => b.comp - a.comp);
}

export function compFinder(periods: SssPeriod[]): (p: FinPeriod) => SssPeriod | null {
  return (p: FinPeriod) => {
    const t = Date.parse(p.date);
    if (Number.isNaN(t)) return null;
    let best: SssPeriod | null = null;
    let bestDiff = Infinity;
    for (const sp of periods) {
      const d = Math.abs(Date.parse(sp.fpEnd) - t);
      if (d <= 25 * DAY && d < bestDiff) {
        best = sp;
        bestDiff = d;
      }
    }
    return best;
  };
}
