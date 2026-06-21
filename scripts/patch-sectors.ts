/**
 * Repair sector ETF series + sector aggregate returns when a refresh left them
 * empty (the ETFs are fetched last in build-data, so a tail-of-run rate-limit on the
 * CI runner can blank them). Re-fetches the 11 SPDR sector ETFs and patches every
 * universe snapshot's `sectors[].returns`. Run: `npx tsx scripts/patch-sectors.ts`
 */
import fs from "node:fs";
import path from "node:path";
import YahooFinance from "yahoo-finance2";
import { SECTOR_ETFS } from "../lib/sectors";
import { LOOKBACK_TRADING_DAYS } from "../lib/timeframes";
import { UNIVERSES } from "../lib/universes";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const YEAR = new Date().getFullYear();
const round2 = (n: number) => Math.round(n * 100) / 100;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Pt { t: number; c: number }
const toPoints = (quotes: any[]): Pt[] =>
  (quotes || []).filter((q) => q && q.date && typeof q.close === "number").map((q) => ({ t: new Date(q.date).getTime(), c: q.close }));
const toXY = (pts: Pt[]) => pts.map((p) => [p.t, round2(p.c)]);

function returnsFromPoints(pts: Pt[]) {
  const closes = pts.map((p) => p.c);
  const last = closes.length ? closes[closes.length - 1] : null;
  const lookback = (n: number): number | null => {
    if (closes.length < 2 || last == null) return null;
    const idx = Math.max(0, closes.length - 1 - n);
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
  if (closes.length >= 2 && last != null) { const prev = closes[closes.length - 2]; if (prev) d1 = (last / prev - 1) * 100; }
  return {
    "1d": d1, "1w": lookback(LOOKBACK_TRADING_DAYS["1w"]), "3m": lookback(LOOKBACK_TRADING_DAYS["3m"]),
    "6m": lookback(LOOKBACK_TRADING_DAYS["6m"]), ytd, "1y": lookback(LOOKBACK_TRADING_DAYS["1y"]),
    "3y": lookback(LOOKBACK_TRADING_DAYS["3y"]), "5y": lookback(LOOKBACK_TRADING_DAYS["5y"]),
  };
}

async function main() {
  const now = Date.now();
  const dailyPeriod1 = new Date(now - 6 * 365 * 86_400_000);
  const intradayPeriod1 = new Date(now - 6 * 86_400_000);
  const etfReturns = new Map<string, ReturnType<typeof returnsFromPoints>>();
  let ok = 0;

  for (const etf of SECTOR_ETFS) {
    let daily: Pt[] = [], intraday: Pt[] = [];
    for (let a = 0; a < 4 && daily.length === 0; a++) {
      if (a > 0) await sleep(1500);
      try { const ch: any = await yf.chart(etf, { period1: dailyPeriod1, interval: "1d" }, { validateResult: false }); daily = toPoints(ch?.quotes); } catch {}
    }
    try { const ch: any = await yf.chart(etf, { period1: intradayPeriod1, interval: "15m" }, { validateResult: false }); intraday = toPoints(ch?.quotes); } catch {}
    const r = returnsFromPoints(daily);
    try { const q: any = await yf.quote(etf, {}, { validateResult: false }); if (q && typeof q.regularMarketChangePercent === "number") r["1d"] = q.regularMarketChangePercent; } catch {}
    etfReturns.set(etf, r);
    if (daily.length > 0) { fs.writeFileSync(path.join("data", "series", "symbols", `${etf}.json`), JSON.stringify({ daily: toXY(daily), intraday: toXY(intraday) })); ok++; }
    process.stderr.write(`  ${etf}: ${daily.length} pts · 5y ${r["5y"] == null ? "—" : r["5y"].toFixed(0) + "%"}\n`);
  }

  if (ok === 0) { console.error("All ETF fetches failed — not patching."); process.exit(1); }

  let patched = 0;
  for (const u of UNIVERSES) {
    const p = path.join("data", u.id, "snapshot.json");
    if (!fs.existsSync(p)) continue;
    const snap = JSON.parse(fs.readFileSync(p, "utf8"));
    if (!Array.isArray(snap.sectors)) continue;
    let any = false;
    for (const s of snap.sectors) { const r = etfReturns.get(s.etf); if (r) { s.returns = r; any = true; } }
    if (any) { fs.writeFileSync(p, JSON.stringify(snap)); patched++; }
  }
  console.log(`Re-fetched ${ok}/${SECTOR_ETFS.length} ETFs; patched sectors in ${patched} universes.`);
}

main();
