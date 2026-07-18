import { yahoo } from "./yahooClient";

const DAY = 86_400_000;
const g = (v: any): number | null =>
  v == null ? null : typeof v === "number" ? (Number.isFinite(v) ? v : null) : typeof v === "object" && typeof v.raw === "number" ? v.raw : null;

export interface EMPoint { t: number; price: number; eps: number; fair: number; lo: number; hi: number }
export interface EarningsMultiple {
  asOf: string;
  series: EMPoint[]; // weekly
  normalPE: number; // median historical P/E ("fair" multiple)
  loPE: number; // 25th percentile
  hiPE: number; // 75th percentile
  currentPE: number | null;
  price: number;
  fair: number; // current EPS × normalPE
  premiumPct: number | null; // (price / fair − 1) × 100
  epsCagr: number | null; // annualized EPS growth across the reported window
  years: number;
}

/**
 * "Earnings multiple" / FAST-Graphs-style chart: the stock's price vs. what it
 * would be worth at its own *normal* P/E (the ~5-yr median multiple) applied to
 * trailing diluted EPS. Where price runs above the band, the market is paying a
 * premium to its own history; below, a discount. EPS is stepped across the weekly
 * price with a ~75-day reporting lag (trailing, no look-ahead). Yahoo only serves
 * ~4–5 years of free fundamentals, so the window is bounded by that.
 */
export async function getEarningsMultiple(symbol: string): Promise<EarningsMultiple | null> {
  try {
    const [a, ch]: any = await Promise.all([
      yahoo.fundamentalsTimeSeries(symbol, { period1: "2016-01-01", type: "annual", module: "all" } as any, { validateResult: false }),
      yahoo.chart(symbol, { period1: "2017-01-01", interval: "1wk" } as any, { validateResult: false }),
    ]);
    const periods = (a || [])
      .map((p: any) => ({ date: new Date(p.date).getTime(), avail: new Date(p.date).getTime() + 75 * DAY, eps: g(p.dilutedEPS) }))
      .filter((p: any) => p.eps != null && p.eps > 0)
      .sort((x: any, y: any) => x.avail - y.avail);
    if (periods.length < 2) return null;

    const quotes = (ch.quotes || [])
      .filter((q: any) => q?.date && q.close != null)
      .map((q: any) => ({ t: new Date(q.date).getTime(), c: q.close }));
    if (quotes.length < 30) return null;

    // step the most recently reported annual EPS across each weekly price
    const stepped: { t: number; price: number; eps: number }[] = [];
    for (const q of quotes) {
      let p: any = null;
      for (const pp of periods) {
        if (pp.avail <= q.t) p = pp;
        else break;
      }
      if (!p) continue;
      stepped.push({ t: q.t, price: q.c, eps: p.eps });
    }
    if (stepped.length < 30) return null;

    // the stock's own normal multiple = median of its trailing P/E over the window
    const pes = stepped.map((s) => s.price / s.eps).filter((v) => Number.isFinite(v) && v > 0).sort((x, y) => x - y);
    if (pes.length < 12) return null;
    const q = (pp: number) => pes[Math.min(pes.length - 1, Math.max(0, Math.round(pp * (pes.length - 1))))];
    const normalPE = q(0.5), loPE = q(0.25), hiPE = q(0.75);

    const series: EMPoint[] = stepped.map((s) => ({
      t: s.t,
      price: s.price,
      eps: s.eps,
      fair: s.eps * normalPE,
      lo: s.eps * loPE,
      hi: s.eps * hiPE,
    }));
    const last = stepped[stepped.length - 1];
    const fair = last.eps * normalPE;

    const firstEps = periods[0].eps, lastEps = periods[periods.length - 1].eps;
    const yrs = (periods[periods.length - 1].date - periods[0].date) / (365.25 * DAY);
    const epsCagr = firstEps > 0 && lastEps > 0 && yrs > 0.5 ? Math.pow(lastEps / firstEps, 1 / yrs) - 1 : null;

    return {
      asOf: new Date(last.t).toISOString().slice(0, 10),
      series,
      normalPE,
      loPE,
      hiPE,
      currentPE: last.price / last.eps,
      price: last.price,
      fair,
      premiumPct: fair > 0 ? (last.price / fair - 1) * 100 : null,
      epsCagr,
      years: Math.max(1, Math.round(stepped.length / 52)),
    };
  } catch {
    return null;
  }
}
