import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);

const num = (v: any): number | null =>
  v == null ? null : typeof v === "number" ? (Number.isFinite(v) ? v : null) : typeof v === "object" && typeof v.raw === "number" ? v.raw : null;
const dstr = (v: any): string => {
  if (!v) return "";
  try {
    return new Date(v).toISOString().slice(0, 10);
  } catch {
    return "";
  }
};

export interface RatingChange {
  firm: string;
  action: string; // up | down | init | main | reit
  fromGrade: string;
  toGrade: string;
  targetTo: number | null;
  targetFrom: number | null;
  date: string;
}
export interface Ratings {
  consensus: string | null;
  mean: number | null;
  numAnalysts: number | null;
  targetMean: number | null;
  targetHigh: number | null;
  targetLow: number | null;
  price: number | null;
  changes: RatingChange[];
}

/** Recent analyst rating changes + consensus for one ticker (lightweight — for
 *  the stock page). Mirrors the data in the financials Estimates tab. */
export async function getRatings(symbol: string): Promise<Ratings | null> {
  try {
    const r: any = await yf.quoteSummary(
      symbol,
      { modules: ["financialData", "upgradeDowngradeHistory"] as any },
      { validateResult: false },
    );
    const fd = r.financialData || {};
    const ud = r.upgradeDowngradeHistory?.history || [];
    return {
      consensus: fd.recommendationKey ?? null,
      mean: num(fd.recommendationMean),
      numAnalysts: num(fd.numberOfAnalystOpinions),
      targetMean: num(fd.targetMeanPrice),
      targetHigh: num(fd.targetHighPrice),
      targetLow: num(fd.targetLowPrice),
      price: num(fd.currentPrice),
      changes: ud
        .map((h: any) => ({
          firm: h.firm || "",
          action: String(h.action || ""),
          fromGrade: h.fromGrade || "",
          toGrade: h.toGrade || "",
          targetTo: num(h.currentPriceTarget),
          targetFrom: num(h.priorPriceTarget),
          date: dstr(h.epochGradeDate),
        }))
        .filter((c: RatingChange) => c.firm && c.date)
        .sort((a: RatingChange, b: RatingChange) => b.date.localeCompare(a.date))
        .slice(0, 24),
    };
  } catch {
    return null;
  }
}
