/**
 * Live single-symbol fetch — builds a StockRow + chart series for ANY Yahoo ticker
 * on demand, so the stock page can render symbols that aren't in a precomputed
 * universe snapshot (when-issued spinoffs like MBGL-WI, fresh IPOs, ADRs, off-index
 * names). Mirrors the per-symbol logic in scripts/build-data.ts (quote + 5.5y daily
 * chart → returns, with the same split/spinoff continuity adjustment) but for one
 * symbol at request time. Returns null when Yahoo has nothing usable (the caller
 * then 404s, same as before).
 */
import YahooFinance from "yahoo-finance2";
import type { StockRow, Returns, SeriesPoint, XY, StockSeries } from "./types";
import { LOOKBACK_TRADING_DAYS } from "./timeframes";
import { adjustForCorporateActions, splitsFromYahoo } from "./splits";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DAY = 86_400_000;

// GICS-ish Yahoo sector → the app's sector ETF (kept in sync with build-data.ts).
const YH_SECTOR_TO_ETF: Record<string, string> = {
  Technology: "XLK",
  Healthcare: "XLV",
  "Financial Services": "XLF",
  "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP",
  Energy: "XLE",
  Industrials: "XLI",
  "Basic Materials": "XLB",
  "Real Estate": "XLRE",
  Utilities: "XLU",
  "Communication Services": "XLC",
};

const round2 = (n: number) => Math.round(n * 100) / 100;
const toXY = (pts: SeriesPoint[]): XY[] => pts.map((p) => [p.t, round2(p.c)]);

function toPoints(quotes: any[]): SeriesPoint[] {
  return (quotes || [])
    .filter((q) => q && q.close != null && q.date)
    .map((q) => ({ t: new Date(q.date).getTime(), c: q.close as number }))
    .sort((a, b) => a.t - b.t);
}
function adjCloseXY(quotes: any[]): XY[] {
  return (quotes || [])
    .filter((q) => q && q.date && (q.adjclose ?? q.adjClose) != null)
    .map((q) => [new Date(q.date).getTime(), (q.adjclose ?? q.adjClose) as number] as XY)
    .sort((a, b) => a[0] - b[0]);
}
function emptyReturns(): Returns {
  return { "1d": null, "1w": null, "3m": null, "6m": null, ytd: null, "1y": null, "3y": null, "5y": null };
}
function returnsFromPoints(pts: SeriesPoint[]): Returns {
  const closes = pts.map((p) => p.c);
  const last = closes.length ? closes[closes.length - 1] : null;
  const year = new Date().getFullYear();
  const lookback = (n: number): number | null => {
    if (closes.length < 2 || last == null) return null;
    const idx = Math.max(0, closes.length - 1 - n);
    const base = closes[idx];
    return base ? (last / base - 1) * 100 : null;
  };
  let ytd: number | null = null;
  const firstThisYear = pts.findIndex((p) => new Date(p.t).getFullYear() === year);
  if (firstThisYear >= 0 && last != null) {
    const base = closes[firstThisYear > 0 ? firstThisYear - 1 : firstThisYear];
    if (base) ytd = (last / base - 1) * 100;
  }
  let d1: number | null = null;
  if (closes.length >= 2 && last != null) {
    const prev = closes[closes.length - 2];
    if (prev) d1 = (last / prev - 1) * 100;
  }
  return {
    "1d": d1,
    "1w": lookback(LOOKBACK_TRADING_DAYS["1w"]),
    "3m": lookback(LOOKBACK_TRADING_DAYS["3m"]),
    "6m": lookback(LOOKBACK_TRADING_DAYS["6m"]),
    ytd,
    "1y": lookback(LOOKBACK_TRADING_DAYS["1y"]),
    "3y": lookback(LOOKBACK_TRADING_DAYS["3y"]),
    "5y": lookback(LOOKBACK_TRADING_DAYS["5y"]),
  };
}

const qn = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

/** Fetch one symbol live and assemble a StockRow + chart series. Null if Yahoo has nothing. */
export async function fetchLiveStock(symbol: string): Promise<{ row: StockRow; series: StockSeries } | null> {
  const sym = symbol.toUpperCase();
  const [quote, chart, prof, intra] = await Promise.all([
    (yf.quote(sym, {}, { validateResult: false }) as Promise<any>).catch(() => null),
    (yf.chart(sym, { period1: new Date(Date.now() - 2010 * DAY), interval: "1d", events: "div,split" }, { validateResult: false }) as Promise<any>).catch(() => null),
    (yf.quoteSummary(sym, { modules: ["assetProfile"] }, { validateResult: false }) as Promise<any>).catch(() => null),
    (yf.chart(sym, { period1: new Date(Date.now() - 8 * DAY), interval: "15m" }, { validateResult: false }) as Promise<any>).catch(() => null),
  ]);

  // Daily series + split/spinoff continuity adjustment (same as the nightly build).
  let pts = toPoints(chart?.quotes || []);
  const adjXY = adjCloseXY(chart?.quotes || []);
  const splitEvents = splitsFromYahoo(chart?.events);
  let dailyXY = toXY(pts);
  if (dailyXY.length && (splitEvents.length || adjXY.length)) {
    const { daily } = adjustForCorporateActions(dailyXY, splitEvents, adjXY);
    if (daily.length) { dailyXY = daily; pts = daily.map(([t, c]) => ({ t, c })); }
  }

  const lastClose = pts.length ? pts[pts.length - 1].c : null;
  const price = qn(quote?.regularMarketPrice) ?? lastClose;
  if (price == null) return null; // no price and no chart → nothing to show; caller 404s

  const high = qn(quote?.fiftyTwoWeekHigh) ?? (pts.length ? Math.max(...pts.map((p) => p.c)) : price);
  const low = qn(quote?.fiftyTwoWeekLow) ?? (pts.length ? Math.min(...pts.map((p) => p.c)) : price);
  const sector = (prof?.assetProfile?.sector as string) || "";
  const etf = sector ? YH_SECTOR_TO_ETF[sector] || "" : "";

  const row: StockRow = {
    symbol: sym,
    name: quote?.longName || quote?.shortName || sym,
    etf,
    sector,
    industry: (prof?.assetProfile?.industry as string) || sector || "Other",
    marketCap: qn(quote?.marketCap) ?? 0,
    price,
    returns: pts.length ? returnsFromPoints(pts) : emptyReturns(),
    fiftyTwoWeekHigh: high || price,
    fiftyTwoWeekLow: low || price,
    pctFromHigh: high ? (price / high - 1) * 100 : 0,
    pctFromLow: low ? (price / low - 1) * 100 : 0,
    trailingPE: qn(quote?.trailingPE),
    forwardPE: qn(quote?.forwardPE),
    priceToBook: qn(quote?.priceToBook),
    dividendYield: null, // filled by the live Stats tab (avoids %-vs-fraction ambiguity from quote)
    fiftyDayAverage: qn(quote?.fiftyDayAverage),
    twoHundredDayAverage: qn(quote?.twoHundredDayAverage),
    earningsDate: null,
    earningsEstimate: false,
    epsForward: qn(quote?.epsForward),
    fund: null,
  };
  const series: StockSeries = { daily: dailyXY, intraday: toXY(toPoints(intra?.quotes || [])) };
  return { row, series };
}
