import type { StockRow } from "./types";

// The fields a plain-English screen can filter/sort on. Values are normalized to the
// units in `desc` (percent fields → percent numbers, market cap → billions) so the
// model reasons in intuitive units; `unit` drives display formatting in the UI.
export type ScreenUnit = "pct" | "ratio" | "moneyB" | "price" | "plain";

export interface ScreenField {
  key: string;
  label: string;
  desc: string; // shown to the model, includes the unit convention
  unit: ScreenUnit;
  get: (s: StockRow) => number | null;
}

const pct = (v: number | null | undefined) => (v == null ? null : v * 100);

export const SCREEN_FIELDS: ScreenField[] = [
  { key: "marketCapB", label: "Mkt Cap", desc: "market capitalization in billions (e.g. 10 = $10B, 2000 = $2T)", unit: "moneyB", get: (s) => (s.marketCap ? s.marketCap / 1e9 : null) },
  { key: "price", label: "Price", desc: "share price", unit: "price", get: (s) => s.price ?? null },
  { key: "trailingPE", label: "P/E", desc: "trailing price/earnings ratio", unit: "ratio", get: (s) => s.trailingPE ?? null },
  { key: "forwardPE", label: "Fwd P/E", desc: "forward price/earnings ratio", unit: "ratio", get: (s) => s.forwardPE ?? null },
  { key: "priceToBook", label: "P/B", desc: "price/book ratio", unit: "ratio", get: (s) => s.priceToBook ?? null },
  { key: "dividendYieldPct", label: "Div Yld", desc: "dividend yield in percent (e.g. 2.5 = 2.5%)", unit: "pct", get: (s) => pct(s.dividendYield) },
  { key: "revGrowthPct", label: "Rev Gr", desc: "latest fiscal-year revenue growth YoY in percent (e.g. 20 = 20%)", unit: "pct", get: (s) => pct(s.fund?.revGrowth) },
  { key: "revCagr3yPct", label: "Rev 3yr", desc: "3-year revenue CAGR in percent", unit: "pct", get: (s) => pct(s.fund?.revCagr3y) },
  { key: "grossMarginPct", label: "Gross Mgn", desc: "gross margin in percent", unit: "pct", get: (s) => pct(s.fund?.grossMargin) },
  { key: "opMarginPct", label: "Op Mgn", desc: "operating margin in percent", unit: "pct", get: (s) => pct(s.fund?.opMargin) },
  { key: "netMarginPct", label: "Net Mgn", desc: "net profit margin in percent (use > 0 for 'profitable')", unit: "pct", get: (s) => pct(s.fund?.netMargin) },
  { key: "fcfMarginPct", label: "FCF Mgn", desc: "free cash flow margin in percent", unit: "pct", get: (s) => pct(s.fund?.fcfMargin) },
  { key: "roePct", label: "ROE", desc: "return on equity in percent", unit: "pct", get: (s) => pct(s.fund?.roe) },
  { key: "netDebtEbitda", label: "NetDebt/EBITDA", desc: "net debt / EBITDA (lower = less levered; negative = net cash)", unit: "ratio", get: (s) => s.fund?.netDebtEbitda ?? null },
  { key: "currentRatio", label: "Current", desc: "current ratio (liquidity; >1 = current assets cover current liabilities)", unit: "ratio", get: (s) => s.fund?.currentRatio ?? null },
  { key: "ytdReturnPct", label: "YTD", desc: "year-to-date price return in percent", unit: "pct", get: (s) => s.returns?.ytd ?? null },
  { key: "oneYearReturnPct", label: "1Y", desc: "1-year price return in percent", unit: "pct", get: (s) => s.returns?.["1y"] ?? null },
  { key: "pctFromHigh", label: "% fr High", desc: "percent from the 52-week high (0 = at high, -25 = 25% below the high)", unit: "pct", get: (s) => s.pctFromHigh ?? null },
  { key: "pctFromLow", label: "% fr Low", desc: "percent above the 52-week low", unit: "pct", get: (s) => s.pctFromLow ?? null },
];

export const FIELD_KEYS = SCREEN_FIELDS.map((f) => f.key);
const FIELD_MAP: Record<string, ScreenField> = Object.fromEntries(SCREEN_FIELDS.map((f) => [f.key, f]));
export const fieldDef = (key: string): ScreenField | undefined => FIELD_MAP[key];

export const GICS_SECTORS = [
  "Information Technology", "Health Care", "Financials", "Consumer Discretionary",
  "Communication Services", "Industrials", "Consumer Staples", "Energy",
  "Utilities", "Real Estate", "Materials",
];

export type ScreenOp = "lt" | "lte" | "gt" | "gte";
export interface ScreenFilter { field: string; op: ScreenOp; value: number }
export interface ScreenSpec {
  filters: ScreenFilter[];
  sectors?: string[];
  sortBy?: string;
  sortDir?: "asc" | "desc";
  limit?: number;
  interpretation: string;
}

function passesFilter(v: number | null, op: ScreenOp, value: number): boolean {
  if (v == null) return false; // missing data → exclude (can't confirm the criterion)
  switch (op) {
    case "lt": return v < value;
    case "lte": return v <= value;
    case "gt": return v > value;
    case "gte": return v >= value;
  }
}

/** Apply a translated screen spec to a list of stocks. */
export function applyScreen(stocks: StockRow[], spec: ScreenSpec): StockRow[] {
  const sectors = (spec.sectors ?? []).map((x) => x.toLowerCase()).filter(Boolean);
  let out = stocks.filter((s) => {
    for (const f of spec.filters) {
      const def = FIELD_MAP[f.field];
      if (!def) continue;
      if (!passesFilter(def.get(s), f.op, f.value)) return false;
    }
    if (sectors.length) {
      const sec = (s.sector || "").toLowerCase();
      if (!sectors.some((x) => sec.includes(x) || x.includes(sec))) return false;
    }
    return true;
  });
  const sortDef = spec.sortBy ? FIELD_MAP[spec.sortBy] : null;
  if (sortDef) {
    const dir = spec.sortDir === "asc" ? 1 : -1;
    out = out.slice().sort((a, b) => {
      const av = sortDef.get(a), bv = sortDef.get(b);
      if (av == null) return 1;
      if (bv == null) return -1;
      return (av - bv) * dir;
    });
  } else {
    out = out.slice().sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0));
  }
  return out.slice(0, Math.min(spec.limit ?? 50, 100));
}
