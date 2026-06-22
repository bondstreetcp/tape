import YahooFinance from "yahoo-finance2";
import { getEdgarQuarterly } from "./edgarFinancials";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);

export interface FinPeriod {
  date: string; // YYYY-MM-DD period end
  [field: string]: number | string | null;
}

export interface Financials {
  annual: FinPeriod[];
  quarterly: FinPeriod[];
}

// Line items we surface (income statement, balance sheet, cash flow). Yahoo
// returns ~140 fields per period; we keep the ones the tables/derived rows use.
const KEEP = [
  // income statement
  "totalRevenue",
  "costOfRevenue",
  "grossProfit",
  "researchAndDevelopment",
  "sellingGeneralAndAdministration",
  "operatingExpense",
  "operatingIncome",
  "EBIT",
  "EBITDA",
  "pretaxIncome",
  "taxProvision",
  "interestExpense",
  "netIncome",
  "netIncomeCommonStockholders",
  "basicEPS",
  "dilutedEPS",
  "dilutedAverageShares",
  "basicAverageShares",
  // balance sheet
  "cashAndCashEquivalents",
  "cashEquivalents",
  "cashCashEquivalentsAndShortTermInvestments",
  "currentAssets",
  "totalAssets",
  "currentLiabilities",
  "totalDebt",
  "longTermDebt",
  "totalLiabilitiesNetMinorityInterest",
  "stockholdersEquity",
  "commonStockEquity",
  "retainedEarnings",
  "workingCapital",
  "investedCapital",
  "ordinarySharesNumber",
  // cash flow
  "operatingCashFlow",
  "capitalExpenditure",
  "freeCashFlow",
  "investingCashFlow",
  "financingCashFlow",
  "cashDividendsPaid",
  "repurchaseOfCapitalStock",
  "stockBasedCompensation",
  "depreciationAndAmortization",
  "changeInWorkingCapital",
  "endCashPosition",
];

async function fetchType(
  symbol: string,
  type: "annual" | "quarterly",
): Promise<FinPeriod[]> {
  try {
    const r: any = await yf.fundamentalsTimeSeries(
      symbol,
      { period1: "2019-01-01", type, module: "all" },
      { validateResult: false },
    );
    const rows: any[] = Array.isArray(r) ? r : [];
    return rows
      .map((row) => {
        const d = row.date?.toISOString?.() || String(row.date ?? "");
        const out: FinPeriod = { date: d.slice(0, 10) };
        for (const k of KEEP) if (row[k] != null) out[k] = row[k];
        return out;
      })
      .filter((p) => p.date);
  } catch {
    return [];
  }
}

/**
 * Merge EDGAR's deep quarterly history with Yahoo's recent quarters. Keyed by
 * the period-end month (the two sources occasionally differ by a couple of days),
 * Yahoo wins where they overlap (richer field set + freshest), EDGAR fills the
 * years Yahoo doesn't serve. Keeps the most recent ~20 quarters (≈5 years).
 */
function mergeQuarterly(edgar: FinPeriod[], yahoo: FinPeriod[]): FinPeriod[] {
  const key = (d: string) => d.slice(0, 7); // YYYY-MM
  const byKey = new Map<string, FinPeriod>();
  for (const p of edgar) byKey.set(key(p.date), p);
  for (const p of yahoo) byKey.set(key(p.date), { ...(byKey.get(key(p.date)) || {}), ...p });
  return [...byKey.values()].sort((a, b) => a.date.localeCompare(b.date)).slice(-20);
}

export async function getFinancials(symbol: string): Promise<Financials> {
  const [annual, quarterly, edgarQ] = await Promise.all([
    fetchType(symbol, "annual"),
    fetchType(symbol, "quarterly"),
    getEdgarQuarterly(symbol).catch(() => [] as FinPeriod[]),
  ]);
  return { annual, quarterly: edgarQ.length ? mergeQuarterly(edgarQ, quarterly) : quarterly };
}

/** One quarter of the income-statement essentials, for the margins/growth chart. */
export interface QuarterPoint {
  date: string; // YYYY-MM-DD period end
  rev: number | null; // total revenue
  gp: number | null; // gross profit
  oi: number | null; // operating income (EBIT)
}

/**
 * Deep QUARTERLY revenue / gross profit / operating income for the margins & growth chart —
 * the same EDGAR-deep + Yahoo-recent merge as getFinancials but UNCAPPED (Yahoo wins on
 * overlap, EDGAR fills the older years), trimmed to the last `maxQuarters` (~11yr). Kept
 * separate from getFinancials so the statement TABLE stays at ~5yr of columns while the
 * chart can reach back a decade. Non-US filers (no EDGAR) fall back to Yahoo's ~5yr.
 */
export async function getQuarterlyHistory(symbol: string, maxQuarters = 44): Promise<QuarterPoint[]> {
  const [yahoo, edgar] = await Promise.all([
    fetchType(symbol, "quarterly"),
    getEdgarQuarterly(symbol).catch(() => [] as FinPeriod[]),
  ]);
  const num = (p: FinPeriod, k: string) => (typeof p[k] === "number" ? (p[k] as number) : null);
  const gp = (p: FinPeriod) => {
    const g = num(p, "grossProfit");
    if (g != null) return g;
    const r = num(p, "totalRevenue"), c = num(p, "costOfRevenue");
    return r != null && c != null ? r - c : null;
  };
  const toPt = (p: FinPeriod, edgarSrc: boolean) => ({ date: p.date, rev: num(p, "totalRevenue"), gp: gp(p), oi: num(p, "operatingIncome") ?? num(p, "EBIT"), e: edgarSrc });

  // EDGAR (deep, authoritative) + Yahoo (recent), sorted, then collapse near-duplicate
  // quarter-ends: the two sources date the same fiscal quarter a few days apart, which can
  // straddle a month boundary and otherwise leaves a stray half-empty quarter (the gap).
  const DAY = 86_400_000;
  const all = [...edgar.map((p) => toPt(p, true)), ...yahoo.map((p) => toPt(p, false))].sort((a, b) => a.date.localeCompare(b.date));
  const out: ReturnType<typeof toPt>[] = [];
  for (const p of all) {
    const last = out[out.length - 1];
    if (last && Date.parse(p.date) - Date.parse(last.date) < 25 * DAY) {
      for (const k of ["rev", "gp", "oi"] as const) if (p[k] != null && (last[k] == null || (p.e && !last.e))) last[k] = p[k]; // prefer EDGAR, fill gaps
      if (p.e) { last.date = p.date; last.e = true; }
    } else out.push({ ...p });
  }
  return out.slice(-maxQuarters).map(({ date, rev, gp, oi }) => ({ date, rev, gp, oi }));
}
