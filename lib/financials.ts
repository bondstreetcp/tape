import YahooFinance from "yahoo-finance2";

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

export async function getFinancials(symbol: string): Promise<Financials> {
  const [annual, quarterly] = await Promise.all([
    fetchType(symbol, "annual"),
    fetchType(symbol, "quarterly"),
  ]);
  return { annual, quarterly };
}
