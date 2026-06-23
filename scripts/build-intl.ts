/**
 * Generate snapshot + series + constituents data for the international index
 * universes (CAC 40, AEX, KOSPI), mirroring the US pipeline's output shape so the
 * existing universe pages (screener, heatmap, treemap, sector views) work as-is.
 * Run: `npx tsx scripts/build-intl.ts [universeId]` (omit id to build all).
 * Any ticker that fails to fetch is skipped.
 */
import fs from "node:fs";
import path from "node:path";
import YahooFinance from "yahoo-finance2";
import { INTL_UNIVERSES, YAHOO_SECTOR_TO_ETF, type IntlUniverse } from "../lib/intlConstituents";
import { ETF_TO_SECTOR } from "../lib/sectors";
import { LOOKBACK_TRADING_DAYS } from "../lib/timeframes";
import { symbolFile } from "../lib/symbolfile";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const ROOT = path.join(process.cwd(), "data");
const DAY = 86_400_000;
const TFS = ["1d", "1w", "3m", "6m", "ytd", "1y", "3y", "5y"] as const;
const num = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function returnsFrom(closes: { t: number; c: number }[]): Record<string, number | null> {
  const n = closes.length;
  const r: Record<string, number | null> = Object.fromEntries(TFS.map((tf) => [tf, null]));
  if (n < 2) return r;
  const last = closes[n - 1].c;
  r["1d"] = (last / closes[n - 2].c - 1) * 100;
  for (const [tf, lb] of Object.entries(LOOKBACK_TRADING_DAYS)) {
    const idx = n - 1 - lb;
    if (idx >= 0 && closes[idx].c) r[tf] = (last / closes[idx].c - 1) * 100;
  }
  const yr = new Date(closes[n - 1].t).getUTCFullYear();
  const firstOfYear = closes.find((c) => new Date(c.t).getUTCFullYear() === yr);
  if (firstOfYear?.c) r["ytd"] = (last / firstOfYear.c - 1) * 100;
  return r;
}

async function buildOne(uni: IntlUniverse) {
  const rows: any[] = [];
  for (const ticker of uni.tickers) {
    try {
      const [qs, ch, ich]: any = await Promise.all([
        yf.quoteSummary(ticker, { modules: ["price", "assetProfile", "summaryDetail", "defaultKeyStatistics", "calendarEvents"] as any }, { validateResult: false }),
        yf.chart(ticker, { period1: new Date(Date.now() - 6 * 365 * DAY), interval: "1d" } as any, { validateResult: false }),
        // Intraday 15m bars (~last 8 days) so the 1D / 1W chart ranges work for intl names too —
        // those ranges read the intraday series, which was previously never built. Optional: a
        // failed intraday pull must not drop the name's daily series, so swallow it.
        yf.chart(ticker, { period1: new Date(Date.now() - 8 * DAY), interval: "15m", includePrePost: false } as any, { validateResult: false }).catch(() => ({ quotes: [] })),
      ]);
      const price = qs.price || {}, prof = qs.assetProfile || {}, sd = qs.summaryDetail || {}, dks = qs.defaultKeyStatistics || {};
      // Yahoo carries upcoming earnings dates for most intl names via calendarEvents (quote()'s
      // earningsTimestampStart is garbage for non-US tickers, so use this instead).
      const earn = qs.calendarEvents?.earnings || {};
      const earnTs = Array.isArray(earn.earningsDate) ? earn.earningsDate[0] : earn.earningsDate;
      const closes = (ch.quotes || [])
        .filter((q: any) => q?.date && q.close != null)
        .map((q: any) => ({ t: new Date(q.date).getTime(), c: q.close }));
      if (closes.length < 20) { console.log("  skip (no series):", ticker); continue; }
      const intradayXY: [number, number][] = (ich?.quotes || [])
        .filter((q: any) => q?.date && q.close != null)
        .map((q: any) => [new Date(q.date).getTime(), q.close]);
      const last = closes[closes.length - 1].c;
      const etf = YAHOO_SECTOR_TO_ETF[prof.sector] || "XLK";
      const hi = num(sd.fiftyTwoWeekHigh), lo = num(sd.fiftyTwoWeekLow);
      rows.push({
        symbol: ticker,
        name: price.shortName || price.longName || ticker,
        etf,
        sector: ETF_TO_SECTOR[etf]?.name || prof.sector || "Other",
        industry: prof.industry || "Other",
        marketCap: num(price.marketCap) || 0,
        price: num(price.regularMarketPrice) ?? last,
        returns: returnsFrom(closes),
        fiftyTwoWeekHigh: hi ?? last,
        fiftyTwoWeekLow: lo ?? last,
        pctFromHigh: hi ? (last / hi - 1) * 100 : 0,
        pctFromLow: lo ? (last / lo - 1) * 100 : 0,
        trailingPE: num(sd.trailingPE),
        forwardPE: num(sd.forwardPE),
        priceToBook: num(dks.priceToBook),
        dividendYield: num(sd.dividendYield),
        fiftyDayAverage: num(sd.fiftyDayAverage),
        twoHundredDayAverage: num(sd.twoHundredDayAverage),
        earningsDate: earnTs ? new Date(earnTs).toISOString() : null,
        earningsEstimate: !!earn.isEarningsDateEstimate,
      });
      const dir = path.join(ROOT, "series", "symbols");
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, symbolFile(ticker)), JSON.stringify({ daily: closes.map((c: any) => [c.t, c.c]), intraday: intradayXY }));
      console.log("  ok:", ticker.padEnd(11), rows[rows.length - 1].sector);
    } catch (e: any) {
      console.log("  FAIL:", ticker, String(e?.message || e).slice(0, 50));
    }
  }

  // cap-weighted sector aggregates for the home sector cards
  const byEtf: Record<string, any[]> = {};
  for (const row of rows) (byEtf[row.etf] ||= []).push(row);
  const sectors = Object.entries(byEtf).map(([etf, rs]) => {
    const returns: Record<string, number | null> = {};
    for (const tf of TFS) {
      let acc = 0, w = 0;
      for (const r of rs) { const v = r.returns[tf]; if (v != null && r.marketCap) { acc += v * r.marketCap; w += r.marketCap; } }
      returns[tf] = w ? acc / w : null;
    }
    return { etf, name: ETF_TO_SECTOR[etf]?.name || etf, returns };
  });

  const uniDir = path.join(ROOT, uni.id);
  fs.mkdirSync(uniDir, { recursive: true });
  fs.writeFileSync(path.join(uniDir, "snapshot.json"), JSON.stringify({ generatedAt: new Date().toISOString(), stocks: rows, sectors }));
  fs.mkdirSync(path.join(ROOT, "constituents"), { recursive: true });
  fs.writeFileSync(path.join(ROOT, "constituents", `${uni.id}.json`), JSON.stringify(rows.map((r) => ({ symbol: r.symbol, name: r.name, sector: r.sector, industry: r.industry }))));
  console.log(`${uni.id}: ${rows.length}/${uni.tickers.length} names written\n`);
}

(async () => {
  const only = process.argv[2];
  for (const uni of INTL_UNIVERSES) {
    if (only && only !== uni.id) continue;
    console.log(`=== ${uni.name} ===`);
    await buildOne(uni);
  }
})();
