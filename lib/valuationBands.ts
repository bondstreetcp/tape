import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DAY = 86_400_000;
const g = (v: any): number | null =>
  v == null ? null : typeof v === "number" ? (Number.isFinite(v) ? v : null) : typeof v === "object" && typeof v.raw === "number" ? v.raw : null;

export interface MetricBand {
  current: number | null;
  min: number;
  p25: number;
  median: number;
  p75: number;
  max: number;
  percentile: number | null; // where current sits in its own history, 0..1
}
export interface BandSeriesPoint { t: number; pe: number | null; ps: number | null; ev: number | null }
export interface ValuationBands {
  asOf: string;
  series: BandSeriesPoint[]; // weekly
  pe: MetricBand | null;
  ps: MetricBand | null;
  evEbitda: MetricBand | null;
}

function band(vals: number[], current: number | null): MetricBand | null {
  const xs = vals.filter((v) => Number.isFinite(v) && v > 0).sort((a, b) => a - b);
  if (xs.length < 12) return null;
  const q = (p: number) => xs[Math.min(xs.length - 1, Math.max(0, Math.round(p * (xs.length - 1))))];
  const percentile = current != null && current > 0 ? xs.filter((v) => v <= current).length / xs.length : null;
  return { current, min: xs[0], p25: q(0.25), median: q(0.5), p75: q(0.75), max: xs[xs.length - 1], percentile };
}

/** Historical P/E, P/S and EV/EBITDA over ~5y, stepping the most recently
 *  reported annual fundamentals across the weekly price series (with a ~75-day
 *  reporting lag so it's a trailing, no-look-ahead multiple). Yahoo only serves
 *  ~4–5 years of free fundamentals, so the window is bounded by that. */
export async function getValuationBands(symbol: string): Promise<ValuationBands | null> {
  try {
    const [a, ch]: any = await Promise.all([
      yf.fundamentalsTimeSeries(symbol, { period1: "2016-01-01", type: "annual", module: "all" } as any, { validateResult: false }),
      yf.chart(symbol, { period1: "2017-01-01", interval: "1wk" } as any, { validateResult: false }),
    ]);
    const periods = (a || [])
      .map((p: any) => ({
        avail: new Date(p.date).getTime() + 75 * DAY,
        eps: g(p.dilutedEPS),
        rev: g(p.totalRevenue),
        ebitda: g(p.EBITDA),
        shares: g(p.dilutedAverageShares),
        debt: g(p.totalDebt) ?? 0,
        cash: g(p.cashAndCashEquivalents) ?? g(p.cashCashEquivalentsAndShortTermInvestments) ?? 0,
      }))
      .filter((p: any) => p.eps != null || p.rev != null)
      .sort((a: any, b: any) => a.avail - b.avail);
    if (periods.length < 2) return null;

    const quotes = (ch.quotes || [])
      .filter((q: any) => q?.date && q.close != null)
      .map((q: any) => ({ t: new Date(q.date).getTime(), c: q.close }));
    if (quotes.length < 30) return null;

    const series: BandSeriesPoint[] = [];
    for (const q of quotes) {
      let p: any = null;
      for (const pp of periods) {
        if (pp.avail <= q.t) p = pp;
        else break;
      }
      if (!p) continue;
      const mktCap = p.shares ? q.c * p.shares : null;
      const ev = mktCap != null ? mktCap + (p.debt || 0) - (p.cash || 0) : null;
      series.push({
        t: q.t,
        pe: p.eps && p.eps > 0 ? q.c / p.eps : null,
        ps: mktCap != null && p.rev && p.rev > 0 ? mktCap / p.rev : null,
        ev: ev != null && p.ebitda && p.ebitda > 0 ? ev / p.ebitda : null,
      });
    }
    if (series.length < 30) return null;
    const cur = series[series.length - 1];
    return {
      asOf: new Date(quotes[quotes.length - 1].t).toISOString().slice(0, 10),
      series,
      pe: band(series.map((s) => s.pe).filter((v): v is number => v != null), cur.pe),
      ps: band(series.map((s) => s.ps).filter((v): v is number => v != null), cur.ps),
      evEbitda: band(series.map((s) => s.ev).filter((v): v is number => v != null), cur.ev),
    };
  } catch {
    return null;
  }
}
