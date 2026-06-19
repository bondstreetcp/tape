import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);

const num = (v: any): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && typeof v.raw === "number") return v.raw;
  return null;
};
const str = (v: any): string | null =>
  typeof v === "string" ? v : (v?.fmt ?? null);

export interface RatingDist {
  strongBuy: number;
  buy: number;
  hold: number;
  sell: number;
  strongSell: number;
}
export interface EstimatePeriod {
  period: string; // 0q / +1q / 0y / +1y
  endDate: string | null;
  epsAvg: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  epsAnalysts: number | null;
  revAvg: number | null;
  growth: number | null;
}
export interface SurpriseRow {
  quarter: string;
  actual: number | null;
  estimate: number | null;
  surprisePercent: number | null;
}

export interface CompanyStats {
  price: number | null;
  // analysts
  recommendationKey: string | null;
  recommendationMean: number | null;
  numAnalysts: number | null;
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  ratings: RatingDist | null;
  // forward / growth
  forwardEps: number | null;
  trailingEps: number | null;
  earningsGrowth: number | null;
  revenueGrowth: number | null;
  estimates: EstimatePeriod[];
  surprises: SurpriseRow[];
  // valuation
  trailingPE: number | null;
  forwardPE: number | null;
  pegRatio: number | null;
  priceToBook: number | null;
  priceToSales: number | null;
  evToRevenue: number | null;
  evToEbitda: number | null;
  beta: number | null;
  marketCap: number | null;
  enterpriseValue: number | null;
  // profitability
  grossMargins: number | null;
  operatingMargins: number | null;
  profitMargins: number | null;
  returnOnEquity: number | null;
  returnOnAssets: number | null;
  // health
  debtToEquity: number | null;
  currentRatio: number | null;
  totalCash: number | null;
  freeCashflow: number | null;
  // ownership / short
  heldPercentInsiders: number | null;
  heldPercentInstitutions: number | null;
  sharesShort: number | null;
  shortRatio: number | null;
  floatShares: number | null;
  sharesOutstanding: number | null;
  // dividends
  dividendYield: number | null;
  dividendRate: number | null;
  payoutRatio: number | null;
}

export async function getCompanyStats(symbol: string): Promise<CompanyStats | null> {
  try {
    const r: any = await yf.quoteSummary(
      symbol,
      {
        modules: [
          "financialData",
          "defaultKeyStatistics",
          "summaryDetail",
          "recommendationTrend",
          "earningsHistory",
          "earningsTrend",
        ] as any,
      },
      { validateResult: false },
    );
    const fd = r.financialData || {};
    const ks = r.defaultKeyStatistics || {};
    const sd = r.summaryDetail || {};
    const rt = r.recommendationTrend?.trend?.[0] || null;
    const eh = r.earningsHistory?.history || [];
    const et = r.earningsTrend?.trend || [];

    return {
      price: num(fd.currentPrice),
      recommendationKey: str(fd.recommendationKey),
      recommendationMean: num(fd.recommendationMean),
      numAnalysts: num(fd.numberOfAnalystOpinions),
      targetMean: num(fd.targetMeanPrice),
      targetHigh: num(fd.targetHighPrice),
      targetLow: num(fd.targetLowPrice),
      ratings: rt
        ? {
            strongBuy: num(rt.strongBuy) || 0,
            buy: num(rt.buy) || 0,
            hold: num(rt.hold) || 0,
            sell: num(rt.sell) || 0,
            strongSell: num(rt.strongSell) || 0,
          }
        : null,
      forwardEps: num(ks.forwardEps),
      trailingEps: num(ks.trailingEps),
      earningsGrowth: num(fd.earningsGrowth),
      revenueGrowth: num(fd.revenueGrowth),
      estimates: et
        .map((t: any) => ({
          period: String(t.period ?? ""),
          endDate: str(t.endDate),
          epsAvg: num(t.earningsEstimate?.avg),
          epsLow: num(t.earningsEstimate?.low),
          epsHigh: num(t.earningsEstimate?.high),
          epsAnalysts: num(t.earningsEstimate?.numberOfAnalysts),
          revAvg: num(t.revenueEstimate?.avg),
          growth: num(t.growth),
        }))
        .filter((e: EstimatePeriod) => e.epsAvg != null || e.revAvg != null),
      surprises: eh
        .map((h: any) => ({
          quarter: str(h.quarter) || "",
          actual: num(h.epsActual),
          estimate: num(h.epsEstimate),
          surprisePercent: num(h.surprisePercent),
        }))
        .filter((s: SurpriseRow) => s.actual != null || s.estimate != null),
      trailingPE: num(sd.trailingPE),
      forwardPE: num(ks.forwardPE) ?? num(sd.forwardPE),
      pegRatio: num(ks.pegRatio),
      priceToBook: num(ks.priceToBook),
      priceToSales: num(sd.priceToSalesTrailing12Months),
      evToRevenue: num(ks.enterpriseToRevenue),
      evToEbitda: num(ks.enterpriseToEbitda),
      beta: num(ks.beta),
      marketCap: num(sd.marketCap),
      enterpriseValue: num(ks.enterpriseValue),
      grossMargins: num(fd.grossMargins),
      operatingMargins: num(fd.operatingMargins),
      profitMargins: num(fd.profitMargins),
      returnOnEquity: num(fd.returnOnEquity),
      returnOnAssets: num(fd.returnOnAssets),
      debtToEquity: num(fd.debtToEquity),
      currentRatio: num(fd.currentRatio),
      totalCash: num(fd.totalCash),
      freeCashflow: num(fd.freeCashflow),
      heldPercentInsiders: num(ks.heldPercentInsiders),
      heldPercentInstitutions: num(ks.heldPercentInstitutions),
      sharesShort: num(ks.sharesShort),
      shortRatio: num(ks.shortRatio),
      floatShares: num(ks.floatShares),
      sharesOutstanding: num(ks.sharesOutstanding),
      dividendYield: num(sd.dividendYield),
      dividendRate: num(sd.dividendRate),
      payoutRatio: num(sd.payoutRatio),
    };
  } catch {
    return null;
  }
}
