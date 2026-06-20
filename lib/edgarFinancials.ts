import { tickerToCik } from "./edgar";
import type { FinPeriod } from "./financials";

/**
 * Deep QUARTERLY financials from SEC EDGAR XBRL companyfacts — Yahoo only serves
 * ~7 quarters, this reaches back ~8 years. The hard part: XBRL income/cash-flow
 * facts are filed as DURATION values that are often year-to-date (Q2 = 6-month,
 * Q3 = 9-month), and Q4 is only in the 10-K as the full year. We recover discrete
 * quarters by (1) taking facts whose span is ~one quarter directly, then (2)
 * filling the rest (notably Q4) from consecutive-YTD differences within each
 * fiscal year. Balance-sheet items are instants — taken at each quarter end.
 */

const UA = "stock-chart-screener research jameslyeh@gmail.com";
const DAY = 86_400_000;

type Kind = "dur" | "inst";
interface FieldSpec { field: string; concepts: string[]; kind: Kind; unit?: string; negate?: boolean }

const FIELDS: FieldSpec[] = [
  // income statement (duration)
  { field: "totalRevenue", kind: "dur", concepts: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax"] },
  { field: "costOfRevenue", kind: "dur", concepts: ["CostOfGoodsAndServicesSold", "CostOfRevenue", "CostOfGoodsSold"] },
  { field: "grossProfit", kind: "dur", concepts: ["GrossProfit"] },
  { field: "researchAndDevelopment", kind: "dur", concepts: ["ResearchAndDevelopmentExpense"] },
  { field: "sellingGeneralAndAdministration", kind: "dur", concepts: ["SellingGeneralAndAdministrativeExpense"] },
  { field: "operatingIncome", kind: "dur", concepts: ["OperatingIncomeLoss"] },
  { field: "pretaxIncome", kind: "dur", concepts: ["IncomeLossFromContinuingOperationsBeforeIncomeTaxesMinorityInterestAndIncomeLossFromEquityMethodInvestments", "IncomeLossFromContinuingOperationsBeforeIncomeTaxesExtraordinaryItemsNoncontrollingInterest"] },
  { field: "taxProvision", kind: "dur", concepts: ["IncomeTaxExpenseBenefit"] },
  { field: "netIncome", kind: "dur", concepts: ["NetIncomeLoss", "ProfitLoss"] },
  { field: "dilutedEPS", kind: "dur", unit: "USD/shares", concepts: ["EarningsPerShareDiluted"] },
  { field: "basicEPS", kind: "dur", unit: "USD/shares", concepts: ["EarningsPerShareBasic"] },
  { field: "dilutedAverageShares", kind: "dur", unit: "shares", concepts: ["WeightedAverageNumberOfDilutedSharesOutstanding"] },
  // cash flow (duration)
  { field: "operatingCashFlow", kind: "dur", concepts: ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"] },
  { field: "capitalExpenditure", kind: "dur", negate: true, concepts: ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"] },
  { field: "cashDividendsPaid", kind: "dur", negate: true, concepts: ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends"] },
  { field: "repurchaseOfCapitalStock", kind: "dur", negate: true, concepts: ["PaymentsForRepurchaseOfCommonStock"] },
  { field: "depreciationAndAmortization", kind: "dur", concepts: ["DepreciationDepletionAndAmortization", "DepreciationAmortizationAndAccretionNet", "DepreciationAndAmortization"] },
  { field: "stockBasedCompensation", kind: "dur", concepts: ["ShareBasedCompensation"] },
  // balance sheet (instant)
  { field: "cashAndCashEquivalents", kind: "inst", concepts: ["CashAndCashEquivalentsAtCarryingValue"] },
  { field: "currentAssets", kind: "inst", concepts: ["AssetsCurrent"] },
  { field: "totalAssets", kind: "inst", concepts: ["Assets"] },
  { field: "currentLiabilities", kind: "inst", concepts: ["LiabilitiesCurrent"] },
  { field: "totalLiabilitiesNetMinorityInterest", kind: "inst", concepts: ["Liabilities"] },
  { field: "stockholdersEquity", kind: "inst", concepts: ["StockholdersEquity", "StockholdersEquityIncludingPortionAttributableToNoncontrollingInterest"] },
  { field: "retainedEarnings", kind: "inst", concepts: ["RetainedEarningsAccumulatedDeficit"] },
  { field: "longTermDebt", kind: "inst", concepts: ["LongTermDebtNoncurrent", "LongTermDebt"] },
];

const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** discrete-quarter value per period-end for a duration concept */
function durMap(facts: any[]): Map<string, number> {
  const out = new Map<string, number>();
  const byAccn = (a: any, b: any) => String(a.accn).localeCompare(String(b.accn));
  // 1) facts that are already ~one quarter long (latest filing wins on dupes)
  for (const f of [...facts].sort(byAccn)) {
    if (f.start == null || f.end == null || typeof f.val !== "number") continue;
    const sp = span(f.start, f.end);
    if (sp >= 78 && sp <= 100) out.set(f.end, f.val);
  }
  // 2) fill the rest (Q2/Q3/Q4 of concepts filed YTD) from consecutive diffs
  //    within each fiscal year (grouped by the shared YTD start date)
  const groups = new Map<string, any[]>();
  for (const f of facts) {
    if (f.start == null || f.end == null || typeof f.val !== "number") continue;
    if (span(f.start, f.end) < 78) continue;
    let g = groups.get(f.start);
    if (!g) { g = []; groups.set(f.start, g); }
    g.push(f);
  }
  for (const gs of groups.values()) {
    const byEnd = new Map<string, any>();
    for (const f of [...gs].sort(byAccn)) byEnd.set(f.end, f); // latest filing per end
    const seq = [...byEnd.values()].sort((a, b) => a.end.localeCompare(b.end));
    let prev = 0;
    for (let i = 0; i < seq.length; i++) {
      const disc = seq[i].val - prev;
      prev = seq[i].val;
      // only emit DERIVED quarters (i>0); i==0 is Q1 and already caught in pass 1
      if (i > 0 && !out.has(seq[i].end)) out.set(seq[i].end, disc);
    }
  }
  return out;
}

/** instant value per date for a balance-sheet concept (latest filing wins) */
function instMap(facts: any[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const f of [...facts].sort((a, b) => String(a.accn).localeCompare(String(b.accn)))) {
    if (f.end == null || typeof f.val !== "number") continue;
    out.set(f.end, f.val);
  }
  return out;
}

export async function getEdgarQuarterly(symbol: string): Promise<FinPeriod[]> {
  try {
    const cik = await tickerToCik(symbol);
    if (!cik) return [];
    const padded = cik.replace(/\D/g, "").padStart(10, "0");
    const res = await fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`, {
      headers: { "User-Agent": UA },
      cache: "no-store",
    });
    if (!res.ok) return [];
    const j: any = await res.json();
    const gaap = j?.facts?.["us-gaap"];
    if (!gaap) return [];

    const maps: Record<string, Map<string, number>> = {};
    for (const spec of FIELDS) {
      let chosen: any[] | null = null;
      const unit = spec.unit || "USD";
      for (const c of spec.concepts) {
        const arr = gaap[c]?.units?.[unit];
        if (Array.isArray(arr) && arr.length) { chosen = arr; break; }
      }
      if (!chosen) continue;
      const m = spec.kind === "dur" ? durMap(chosen) : instMap(chosen);
      if (spec.negate) for (const [k, v] of m) m.set(k, -Math.abs(v));
      maps[spec.field] = m;
    }

    // quarter-end dates = union of the income-statement discrete ends
    const ends = new Set<string>();
    for (const f of ["totalRevenue", "netIncome", "operatingIncome"]) {
      const m = maps[f];
      if (m) for (const k of m.keys()) ends.add(k);
    }

    const periods: FinPeriod[] = [];
    for (const end of [...ends].sort()) {
      const p: FinPeriod = { date: end };
      let any = false;
      for (const spec of FIELDS) {
        const v = maps[spec.field]?.get(end);
        if (typeof v === "number") { p[spec.field] = v; any = true; }
      }
      if (typeof p.operatingCashFlow === "number" && typeof p.capitalExpenditure === "number" && p.freeCashFlow == null)
        p.freeCashFlow = (p.operatingCashFlow as number) + (p.capitalExpenditure as number);
      if (p.grossProfit == null && typeof p.totalRevenue === "number" && typeof p.costOfRevenue === "number")
        p.grossProfit = (p.totalRevenue as number) - (p.costOfRevenue as number);
      if (any) periods.push(p);
    }
    return periods;
  } catch {
    return [];
  }
}
