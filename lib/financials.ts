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
