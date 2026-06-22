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
// `concepts` are TOTAL line items (any one is the whole figure — merged, latest filing wins).
// `components` are PARTS that must be SUMMED, used only for a period where no total is tagged
// (e.g. older filings split revenue into goods + services, or cost into CostOfGoodsSold +
// CostOfServices). Never mix a total with its own parts in the same period — totals win.
interface FieldSpec { field: string; concepts: string[]; kind: Kind; unit?: string; negate?: boolean; components?: string[] }

const FIELDS: FieldSpec[] = [
  // income statement (duration)
  { field: "totalRevenue", kind: "dur",
    concepts: ["RevenueFromContractWithCustomerExcludingAssessedTax", "Revenues", "SalesRevenueNet", "RevenueFromContractWithCustomerIncludingAssessedTax", "RegulatedAndUnregulatedOperatingRevenue", "RevenueMineralSales", "RevenuesExcludingInterestAndDividends"],
    // components are summed ONLY when no total above is tagged — keeps a REIT's lease revenue
    // (and goods/services or regulated/unregulated splits) from ever displacing a normal
    // company's `Revenues` total.
    components: ["SalesRevenueGoodsNet", "SalesRevenueServicesNet", "RegulatedOperatingRevenue", "UnregulatedOperatingRevenue", "OperatingLeasesIncomeStatementLeaseRevenue", "RealEstateRevenueNet"] },
  // NB: cost of revenue is NOT reconstructed from component parts — many filers (Oracle,
  // defense) split cost across several concepts we can't fully enumerate, so summing a
  // subset would UNDERCOUNT cost and overstate gross margin. Better an honest gap than a
  // wrong line; rev−cost only fires when a total cost concept is tagged.
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
    const facetMap = (concepts: string[], unit: string, kind: Kind) => {
      // Merge facts across ALL alias concepts rather than first-match-wins — issuers re-tag
      // line items over the years (e.g. Lockheed's cost of revenue moved
      // CostOfGoodsAndServicesSold → CostOfRevenue in 2022). durMap/instMap dedup by
      // period-end (latest filing wins), so concatenating is safe.
      let facts: any[] = [];
      for (const c of concepts) { const arr = gaap[c]?.units?.[unit]; if (Array.isArray(arr) && arr.length) facts = facts.length ? facts.concat(arr) : arr; }
      return facts.length ? (kind === "dur" ? durMap(facts) : instMap(facts)) : new Map<string, number>();
    };
    for (const spec of FIELDS) {
      const unit = spec.unit || "USD";
      const m = facetMap(spec.concepts, unit, spec.kind);
      // Component fallback: for any period the total concepts DON'T cover, sum the parts
      // (e.g. SalesRevenueGoodsNet + SalesRevenueServicesNet, or CostOfGoodsSold +
      // CostOfServices). Totals always win where present, so no double-counting.
      if (spec.components) {
        const compMaps = spec.components.map((c) => facetMap([c], unit, spec.kind));
        const ends = new Set<string>();
        for (const cm of compMaps) for (const k of cm.keys()) ends.add(k);
        for (const end of ends) {
          if (m.has(end)) continue;
          let sum = 0, any = false;
          for (const cm of compMaps) { const v = cm.get(end); if (typeof v === "number") { sum += v; any = true; } }
          if (any) m.set(end, sum);
        }
      }
      if (!m.size) continue;
      if (spec.negate) for (const [k, v] of m) m.set(k, -Math.abs(v));
      maps[spec.field] = m;
    }

    // Calibrated operating-income fallback: where OperatingIncomeLoss isn't tagged, reconstruct
    // it as gross profit − SG&A − R&D — but ONLY for issuers where that formula tracks their
    // ACTUAL operating income closely on overlapping periods (≥3 points, ≥70% within 12%).
    // Otherwise un-captured operating costs would overstate it, so we leave an honest gap.
    {
      const oiM = maps["operatingIncome"], gpM = maps["grossProfit"], sgaM = maps["sellingGeneralAndAdministration"], rndM = maps["researchAndDevelopment"];
      if (oiM && gpM && sgaM) {
        const derived = new Map<string, number>();
        for (const [end, gp] of gpM) { const sga = sgaM.get(end); if (typeof sga === "number") derived.set(end, gp - sga - (rndM?.get(end) ?? 0)); }
        let total = 0, ok = 0;
        for (const [end, d] of derived) { const a = oiM.get(end); if (typeof a === "number" && a !== 0) { total++; if (Math.abs(d - a) / Math.abs(a) <= 0.12) ok++; } }
        if (total >= 3 && ok / total >= 0.7) for (const [end, d] of derived) if (!oiM.has(end)) oiM.set(end, d);
      }
    }

    // quarter-end dates = union of the income-statement discrete ends
    const ends = new Set<string>();
    for (const f of ["totalRevenue", "netIncome", "operatingIncome", "grossProfit"]) {
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
      // Revenue is tagged inconsistently in XBRL for some issuers (concept changes,
      // dimensional facts) even when gross profit AND cost of revenue both are — recover it
      // (rev = gross profit + cost), which restores deep margin history (e.g. Tesla, Macy's).
      if (p.totalRevenue == null && typeof p.grossProfit === "number" && typeof p.costOfRevenue === "number")
        p.totalRevenue = (p.grossProfit as number) + (p.costOfRevenue as number);
      if (p.grossProfit == null && typeof p.totalRevenue === "number" && typeof p.costOfRevenue === "number")
        p.grossProfit = (p.totalRevenue as number) - (p.costOfRevenue as number);
      if (any) periods.push(p);
    }
    return periods;
  } catch {
    return [];
  }
}
