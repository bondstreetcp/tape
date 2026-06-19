import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);

const num = (v: any): number | null => {
  if (v == null) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "object" && typeof v.raw === "number") return v.raw;
  return null;
};
const dstr = (v: any): string | null => {
  if (!v) return null;
  try {
    return new Date(v).toISOString().slice(0, 10);
  } catch {
    return null;
  }
};

export interface Officer { name: string; title: string; pay: number | null }
export interface Holder { name: string; pct: number | null; shares: number | null; value: number | null; change: number | null }
export interface Insider { name: string; relation: string; text: string; shares: number | null; value: number | null; date: string | null }
export interface DividendPay { date: string | null; amount: number | null }

export interface CompanyProfile {
  description: string | null;
  sector: string | null;
  industry: string | null;
  employees: number | null;
  location: string | null;
  website: string | null;
  officers: Officer[];
  nextEarnings: string | null;
  exDividend: string | null;
  dividendDate: string | null;
  institutions: Holder[];
  insiders: Insider[];
  dividends: DividendPay[];
}

export async function getCompanyProfile(symbol: string): Promise<CompanyProfile | null> {
  try {
    const r: any = await yf.quoteSummary(
      symbol,
      {
        modules: [
          "assetProfile",
          "calendarEvents",
          "institutionOwnership",
          "insiderTransactions",
        ] as any,
      },
      { validateResult: false },
    );
    const ap = r.assetProfile || {};
    const ce = r.calendarEvents || {};
    const io = r.institutionOwnership?.ownershipList || [];
    const it = r.insiderTransactions?.transactions || [];

    let dividends: DividendPay[] = [];
    try {
      const ch: any = await yf.chart(
        symbol,
        { period1: "2019-01-01", interval: "1mo", events: "dividends" } as any,
        { validateResult: false },
      );
      const d = ch?.events?.dividends;
      const arr = Array.isArray(d) ? d : Object.values(d || {});
      dividends = (arr as any[])
        .map((x) => ({ date: dstr(x.date), amount: num(x.amount) }))
        .filter((x) => x.amount != null)
        .slice(-12);
    } catch {
      /* dividends optional */
    }

    return {
      description: ap.longBusinessSummary || null,
      sector: ap.sector || null,
      industry: ap.industry || null,
      employees: num(ap.fullTimeEmployees),
      location: [ap.city, ap.state, ap.country].filter(Boolean).join(", ") || null,
      website: ap.website || null,
      officers: (ap.companyOfficers || [])
        .slice(0, 8)
        .map((o: any) => ({ name: o.name, title: o.title, pay: num(o.totalPay) })),
      nextEarnings: dstr(ce.earnings?.earningsDate?.[0]),
      exDividend: dstr(ce.exDividendDate),
      dividendDate: dstr(ce.dividendDate),
      institutions: io.slice(0, 10).map((h: any) => ({
        name: h.organization,
        pct: num(h.pctHeld),
        shares: num(h.position),
        value: num(h.value),
        change: num(h.pctChange),
      })),
      insiders: it.slice(0, 12).map((t: any) => ({
        name: t.filerName,
        relation: t.filerRelation,
        text: t.transactionText,
        shares: num(t.shares),
        value: num(t.value),
        date: dstr(t.startDate),
      })),
      dividends,
    };
  } catch {
    return null;
  }
}
