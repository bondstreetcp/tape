/**
 * Lightweight INTRADAY refresh — updates only each universe's snapshot.json
 * (current price, market cap, valuation, returns) from fresh quotes, WITHOUT
 * rewriting the ~3,000 per-symbol history series. That keeps the git churn of an
 * intraday run to ~15 small files instead of ~1,400, so we can refresh several
 * times a day cheaply. The full history rebuild stays on the after-close run
 * (build-data.ts); this is meant to run between opens and the close.
 *
 * Returns are re-anchored without re-reading history: for any timeframe the
 * historical base price is oldPrice/(1+oldReturn) and is FIXED, so the new return
 * is just newPrice/base − 1. Because each snapshot stores a consistent
 * (price, returns) pair, this is exact off the close build and stable across
 * repeated intraday runs (re-anchoring always reconstructs the same base). The
 * 1-day return comes straight from the quote. Sector aggregates re-read only the
 * 11 sector-ETF series for their anchors. (1w+ anchors carry a ≤1-trading-day
 * skew intraday since the series ends at yesterday's close; the close build
 * re-anchors everything precisely.)
 *
 *   npm run refresh-quotes
 */
import { promises as fs } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { UNIVERSES } from "../lib/universes";
import { SECTOR_ETFS } from "../lib/sectors";
import { LOOKBACK_TRADING_DAYS } from "../lib/timeframes";
import { symbolFile } from "../lib/symbolfile";
import { adjustForSplits, splitsFromYahoo } from "../lib/splits";
import type { Returns, Snapshot, XY } from "../lib/types";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA_DIR = path.join(process.cwd(), "data");
const SYMBOL_DIR = path.join(DATA_DIR, "series", "symbols");
const DAY = 86_400_000;
const NOW = Date.now();
const YEAR = new Date(NOW).getFullYear();
// Window for the per-symbol split re-fetch — matches build-data's ~5.5y daily span.
const SPLIT_REFETCH_PERIOD1 = new Date(NOW - 2010 * DAY);

const qnum = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function fetchQuotes(symbols: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  for (const part of chunk(symbols, 50)) {
    try {
      const qs = (await yf.quote(part, {}, { validateResult: false })) as any[];
      for (const q of qs) if (q?.symbol) map.set(q.symbol, q);
    } catch {
      for (const s of part) {
        try {
          const q = await yf.quote(s, {}, { validateResult: false });
          if (q?.symbol) map.set(q.symbol, q);
        } catch {
          /* skip */
        }
      }
    }
  }
  return map;
}

/** Re-anchor a stock's returns to a new price from its existing (price, returns) pair. */
function reprice(oldPrice: number, old: Returns, newPrice: number, day1: number | null): Returns {
  const ratio = oldPrice > 0 ? newPrice / oldPrice : 1;
  const out = {} as Returns;
  for (const k of Object.keys(old) as (keyof Returns)[]) {
    const r = old[k];
    out[k] = r == null ? null : ratio * (100 + r) - 100; // newRet% = (newPrice/oldPrice)*(100+oldRet%) − 100
  }
  if (day1 != null) out["1d"] = day1;
  return out;
}

/** Timeframe returns of `price` against a daily [t,c] series' lookback anchors (for the ETFs). */
function returnsVsPrice(daily: XY[], price: number, day1: number | null): Returns {
  const closes = daily.map((p) => p[1]);
  const lb = (n: number): number | null => {
    if (closes.length < 2) return null;
    let i = closes.length - 1 - n;
    if (i < 0) i = 0;
    const b = closes[i];
    return b ? (price / b - 1) * 100 : null;
  };
  let ytd: number | null = null;
  const f = daily.findIndex((p) => new Date(p[0]).getFullYear() === YEAR);
  if (f >= 0) { const b = closes[f > 0 ? f - 1 : f]; if (b) ytd = (price / b - 1) * 100; }
  return {
    "1d": day1,
    "1w": lb(LOOKBACK_TRADING_DAYS["1w"]),
    "3m": lb(LOOKBACK_TRADING_DAYS["3m"]),
    "6m": lb(LOOKBACK_TRADING_DAYS["6m"]),
    ytd,
    "1y": lb(LOOKBACK_TRADING_DAYS["1y"]),
    "3y": lb(LOOKBACK_TRADING_DAYS["3y"]),
    "5y": lb(LOOKBACK_TRADING_DAYS["5y"]),
  };
}

/**
 * A >50% jump between intraday ticks is a corporate action (split/reverse-split),
 * not a real price move — so `reprice` would multiply every return by the split
 * factor (the "+198%" bug). Instead, re-fetch the symbol's split-adjusted daily
 * series, recompute returns against the new price from the real history, and
 * rewrite the series file (preserving the existing intraday block). Returns the
 * fresh Returns on success, or null if the re-fetch failed.
 */
async function repairSplit(symbol: string, newPrice: number, day1: number | null): Promise<Returns | null> {
  try {
    const ch: any = await yf.chart(
      symbol,
      { period1: SPLIT_REFETCH_PERIOD1, interval: "1d", events: "split" },
      { validateResult: false },
    );
    const raw: XY[] = (ch?.quotes || [])
      .filter((q: any) => q && q.close != null && q.date)
      .map((q: any) => [new Date(q.date).getTime(), Math.round((q.close as number) * 100) / 100] as XY)
      .sort((a: XY, b: XY) => a[0] - b[0]);
    if (!raw.length) return null;
    const { daily: adjustedDaily } = adjustForSplits(raw, splitsFromYahoo(ch?.events));
    const returns = returnsVsPrice(adjustedDaily, newPrice, day1);
    // Preserve the existing intraday block (read-merge), rewrite daily.
    let intraday: XY[] = [];
    try {
      const prev = JSON.parse(await fs.readFile(path.join(SYMBOL_DIR, symbolFile(symbol)), "utf8"));
      if (Array.isArray(prev.intraday)) intraday = prev.intraday as XY[];
    } catch {
      /* no prior file — write daily only */
    }
    await fs.writeFile(
      path.join(SYMBOL_DIR, symbolFile(symbol)),
      JSON.stringify({ daily: adjustedDaily, intraday }),
    );
    return returns;
  } catch {
    return null;
  }
}

async function main() {
  // 1) Load existing snapshots (skip universes that haven't been built yet).
  const snaps: { id: string; snap: Snapshot }[] = [];
  // ONLY=kospi,nikkei,hsi restricts the run to a subset of universes — used by the overnight
  // Asian-session ticks so we quote ~108 Asian names (live during 00:00–08:00 UTC) instead of the
  // full ~3,400, keeping the Asian snapshots current with the live index while the US is closed.
  const only = (process.env.ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
  for (const u of UNIVERSES) {
    if (only.length && !only.includes(u.id)) continue;
    try {
      snaps.push({ id: u.id, snap: JSON.parse(await fs.readFile(path.join(DATA_DIR, u.id, "snapshot.json"), "utf8")) as Snapshot });
    } catch {
      /* not built yet */
    }
  }
  const syms = new Set<string>();
  for (const { snap } of snaps) for (const s of snap.stocks) syms.add(s.symbol);
  console.log(`Quoting ${syms.size} symbols across ${snaps.length} universes…`);

  const [quoteMap, etfQuoteMap] = await Promise.all([fetchQuotes([...syms]), fetchQuotes(SECTOR_ETFS)]);
  console.log(`  quotes: ${quoteMap.size}/${syms.size}; ETFs: ${etfQuoteMap.size}/${SECTOR_ETFS.length}`);

  // 2) Fresh sector-ETF returns (anchors from the 11 series — read-only — + the live ETF price).
  const etfReturns = new Map<string, Returns>();
  for (const etf of SECTOR_ETFS) {
    let daily: XY[] = [];
    try { daily = (JSON.parse(await fs.readFile(path.join(SYMBOL_DIR, symbolFile(etf)), "utf8")).daily as XY[]) || []; } catch {}
    const q = etfQuoteMap.get(etf);
    const price = qnum(q?.regularMarketPrice) ?? (daily.length ? daily[daily.length - 1][1] : null);
    if (price != null && daily.length >= 2) etfReturns.set(etf, returnsVsPrice(daily, price, qnum(q?.regularMarketChangePercent)));
  }

  // 3) Apply quotes to each snapshot; rewrite only those whose prices actually moved
  //    (so a closed market — e.g. intl during the US session — isn't needlessly re-committed).
  let universesWritten = 0, applied = 0;
  const fixedSymbols: string[] = [];
  for (const { id, snap } of snaps) {
    let changed = false;
    for (const st of snap.stocks) {
      const q = quoteMap.get(st.symbol);
      const np = qnum(q?.regularMarketPrice);
      if (!q || np == null) continue; // no fresh quote → leave as-is
      if (np !== st.price) changed = true;
      const high = qnum(q.fiftyTwoWeekHigh) ?? st.fiftyTwoWeekHigh;
      const low = qnum(q.fiftyTwoWeekLow) ?? st.fiftyTwoWeekLow;
      const day1 = qnum(q.regularMarketChangePercent);
      // Corporate-action guard: a >50% jump between ticks is a split/reverse-split,
      // not a real move. `reprice`'s ratio≈split-factor would corrupt every return
      // (the "+198%" bug), so instead re-fetch the split-adjusted series and
      // recompute returns from the real history.
      const ratio = st.price > 0 ? np / st.price : 1;
      if (ratio > 1.5 || ratio < 0.67) {
        const fixed = await repairSplit(st.symbol, np, day1);
        if (fixed) {
          st.returns = fixed;
          fixedSymbols.push(`${st.symbol} (${ratio.toFixed(2)}×)`);
        } else {
          // Re-fetch failed — don't propagate the bogus ratio through reprice;
          // keep the prior returns and only update the (reliable) 1-day from the quote.
          st.returns = { ...st.returns, "1d": day1 };
        }
      } else {
        st.returns = reprice(st.price, st.returns, np, day1);
      }
      st.price = np;
      st.marketCap = qnum(q.marketCap) ?? st.marketCap;
      st.fiftyTwoWeekHigh = high;
      st.fiftyTwoWeekLow = low;
      st.pctFromHigh = high ? (np / high - 1) * 100 : st.pctFromHigh;
      st.pctFromLow = low ? (np / low - 1) * 100 : st.pctFromLow;
      st.trailingPE = qnum(q.trailingPE) ?? st.trailingPE;
      st.forwardPE = qnum(q.forwardPE) ?? st.forwardPE;
      st.priceToBook = qnum(q.priceToBook) ?? st.priceToBook;
      st.dividendYield = qnum(q.trailingAnnualDividendYield) ?? st.dividendYield;
      st.fiftyDayAverage = qnum(q.fiftyDayAverage) ?? st.fiftyDayAverage;
      st.twoHundredDayAverage = qnum(q.twoHundredDayAverage) ?? st.twoHundredDayAverage;
      if (q.earningsTimestampStart) st.earningsDate = new Date(q.earningsTimestampStart).toISOString();
      if (typeof q.isEarningsDateEstimate === "boolean") st.earningsEstimate = q.isEarningsDateEstimate;
      st.epsForward = qnum(q.epsForward) ?? st.epsForward;
      applied++;
    }
    // sector aggregates: shared ETF returns + recomputed cap/count from the updated stocks
    for (const sec of snap.sectors) {
      const r = etfReturns.get(sec.etf);
      if (r) sec.returns = r;
      const members = snap.stocks.filter((x) => x.etf === sec.etf);
      sec.marketCap = members.reduce((a, b) => a + (b.marketCap || 0), 0);
      sec.count = members.length;
    }
    if (changed) {
      snap.generatedAt = new Date(NOW).toISOString();
      await fs.writeFile(path.join(DATA_DIR, id, "snapshot.json"), JSON.stringify(snap));
      universesWritten++;
      console.log(`  ${id}: updated`);
    } else {
      console.log(`  ${id}: no price change — skipped`);
    }
  }
  if (fixedSymbols.length) {
    // Dedupe — the same symbol can appear in several universes.
    const uniq = [...new Set(fixedSymbols)];
    console.log(`\nCorporate-action repairs (split-adjusted series rewritten): ${uniq.join(", ")}`);
  }
  console.log(`\nDone. ${universesWritten}/${snaps.length} snapshots rewritten, ${applied} quotes applied. (history series untouched except ${new Set(fixedSymbols.map((s) => s.split(" ")[0])).size} split-repaired)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
