/**
 * Repairs the sector-ETF data when a full refresh got rate-limited on the ETF
 * step (empty data/series/symbols/<ETF>.json + null sector returns in every
 * snapshot). Re-fetches just the SPDR sector ETFs (fast) and rewrites their
 * series files + every universe snapshot's sector aggregates.
 *
 *   npx tsx scripts/patch-etfs.ts
 */
import { promises as fs } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { SECTOR_ETFS, SECTORS } from "../lib/sectors";
import { LOOKBACK_TRADING_DAYS } from "../lib/timeframes";
import { symbolFile } from "../lib/symbolfile";
import { UNIVERSES } from "../lib/universes";
import type { Returns, SeriesPoint, Snapshot, XY } from "../lib/types";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA_DIR = path.join(process.cwd(), "data");
const SYMBOL_DIR = path.join(DATA_DIR, "series", "symbols");
const DAY = 86_400_000;
const NOW = Date.now();
const YEAR = new Date(NOW).getFullYear();

const round2 = (n: number) => Math.round(n * 100) / 100;
const toXY = (pts: SeriesPoint[]): XY[] => pts.map((p) => [p.t, round2(p.c)]);

function toPoints(quotes: any[]): SeriesPoint[] {
  return (quotes || [])
    .filter((q) => q && q.close != null && q.date)
    .map((q) => ({ t: new Date(q.date).getTime(), c: q.close as number }))
    .sort((a, b) => a.t - b.t);
}

function emptyReturns(): Returns {
  return { "1d": null, "1w": null, "3m": null, "6m": null, ytd: null, "1y": null, "3y": null, "5y": null };
}

function returnsFromPoints(pts: SeriesPoint[]): Returns {
  const closes = pts.map((p) => p.c);
  const last = closes.length ? closes[closes.length - 1] : null;
  const lookback = (n: number): number | null => {
    if (closes.length < 2 || last == null) return null;
    let idx = closes.length - 1 - n;
    if (idx < 0) idx = 0;
    const base = closes[idx];
    return base ? (last / base - 1) * 100 : null;
  };
  let ytd: number | null = null;
  const firstThisYear = pts.findIndex((p) => new Date(p.t).getFullYear() === YEAR);
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

async function main() {
  const dailyPeriod1 = new Date(NOW - 2010 * DAY);
  const intradayPeriod1 = new Date(NOW - 8 * DAY);
  const etfReturns = new Map<string, Returns>();
  await fs.mkdir(SYMBOL_DIR, { recursive: true });

  console.log(`Fetching ${SECTOR_ETFS.length} sector ETFs…`);
  for (const etf of SECTOR_ETFS) {
    let daily: SeriesPoint[] = [];
    let intraday: SeriesPoint[] = [];
    try {
      const ch: any = await yf.chart(etf, { period1: dailyPeriod1, interval: "1d" }, { validateResult: false });
      daily = toPoints(ch?.quotes);
    } catch (e: any) {
      console.warn(`  ${etf} daily failed: ${e.message}`);
    }
    try {
      const ch: any = await yf.chart(etf, { period1: intradayPeriod1, interval: "15m" }, { validateResult: false });
      intraday = toPoints(ch?.quotes);
    } catch {
      /* intraday optional */
    }
    const r = returnsFromPoints(daily);
    try {
      const q: any = await yf.quote(etf, {}, { validateResult: false });
      if (q && typeof q.regularMarketChangePercent === "number") r["1d"] = q.regularMarketChangePercent;
    } catch {
      /* keep computed 1d */
    }
    etfReturns.set(etf, r);
    await fs.writeFile(
      path.join(SYMBOL_DIR, symbolFile(etf)),
      JSON.stringify({ daily: toXY(daily), intraday: toXY(intraday) }),
    );
    console.log(`  ${etf}: ${daily.length} daily, ${intraday.length} intraday, 1d=${r["1d"]?.toFixed(2) ?? "—"}% ytd=${r.ytd?.toFixed(1) ?? "—"}%`);
  }

  // Patch every snapshot's sector aggregates with the fresh ETF returns.
  for (const u of UNIVERSES) {
    const p = path.join(DATA_DIR, u.id, "snapshot.json");
    let snap: Snapshot;
    try {
      snap = JSON.parse(await fs.readFile(p, "utf8")) as Snapshot;
    } catch {
      continue;
    }
    let patched = 0;
    for (const sec of snap.sectors) {
      const r = etfReturns.get(sec.etf);
      if (r) {
        sec.returns = r;
        patched++;
      }
    }
    await fs.writeFile(p, JSON.stringify(snap));
    console.log(`  patched ${u.id}: ${patched}/${snap.sectors.length} sectors`);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
