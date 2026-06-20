/**
 * Re-fetch daily history for symbols whose shared series file has an empty `daily`
 * array (a big universe refresh can get rate-limited mid-run and leave a block of
 * names with no series → null YTD/returns). Re-fetches just those, rewrites the
 * series file, and recomputes returns in every universe snapshot that holds them.
 *
 *   npx tsx scripts/patch-missing-series.ts
 */
import { promises as fs } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { UNIVERSES } from "../lib/universes";
import { LOOKBACK_TRADING_DAYS } from "../lib/timeframes";
import { symbolFile } from "../lib/symbolfile";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA_DIR = path.join(process.cwd(), "data");
const SYMBOL_DIR = path.join(DATA_DIR, "series", "symbols");
const DAY = 86_400_000;
const NOW = Date.now();
const YEAR = new Date(NOW).getFullYear();

const round2 = (n: number) => Math.round(n * 100) / 100;
type Pt = { t: number; c: number };
function toPoints(quotes: any[]): Pt[] {
  return (quotes || [])
    .filter((q) => q && q.close != null && q.date)
    .map((q) => ({ t: new Date(q.date).getTime(), c: q.close as number }))
    .sort((a, b) => a.t - b.t);
}
const toXY = (pts: Pt[]) => pts.map((p) => [p.t, round2(p.c)]);

function returnsFromPoints(pts: Pt[]) {
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
  } as Record<string, number | null>;
}

async function mapPool<T, R>(items: T[], size: number, fn: (item: T, i: number) => Promise<R>): Promise<R[]> {
  const ret = new Array<R>(items.length);
  let idx = 0;
  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      ret[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return ret;
}

async function main() {
  const snapshots: Record<string, any> = {};
  const symSet = new Set<string>();
  for (const u of UNIVERSES) {
    try {
      const s = JSON.parse(await fs.readFile(path.join(DATA_DIR, u.id, "snapshot.json"), "utf8"));
      snapshots[u.id] = s;
      for (const st of s.stocks) symSet.add(st.symbol);
    } catch {
      /* no snapshot */
    }
  }

  const empty: string[] = [];
  for (const sym of symSet) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(SYMBOL_DIR, symbolFile(sym)), "utf8"));
      if (!(j.daily?.length)) empty.push(sym);
    } catch {
      empty.push(sym);
    }
  }
  console.log(`Symbols with empty daily series: ${empty.length}`);
  if (!empty.length) return;

  const dailyPeriod1 = new Date(NOW - 2010 * DAY);
  const fixed = new Map<string, ReturnType<typeof returnsFromPoints>>();
  let done = 0;
  await mapPool(empty, 12, async (sym) => {
    try {
      const ch: any = await yf.chart(sym, { period1: dailyPeriod1, interval: "1d" }, { validateResult: false });
      const pts = toPoints(ch?.quotes);
      if (pts.length) {
        let intraday: any = [];
        try {
          const old = JSON.parse(await fs.readFile(path.join(SYMBOL_DIR, symbolFile(sym)), "utf8"));
          intraday = old.intraday || [];
        } catch { /* none */ }
        await fs.writeFile(path.join(SYMBOL_DIR, symbolFile(sym)), JSON.stringify({ daily: toXY(pts), intraday }));
        fixed.set(sym, returnsFromPoints(pts));
      }
    } catch { /* still no data */ }
    if (++done % 100 === 0) console.log(`  ${done}/${empty.length}`);
  });
  console.log(`Re-fetched ${fixed.size}/${empty.length}`);

  for (const u of UNIVERSES) {
    const s = snapshots[u.id];
    if (!s) continue;
    let n = 0;
    for (const st of s.stocks) {
      const r = fixed.get(st.symbol);
      if (!r) continue;
      const liveD1 = st.returns?.["1d"]; // keep the live (quote) 1-day if we had it
      st.returns = { ...r, "1d": liveD1 ?? r["1d"] };
      n++;
    }
    if (n) {
      await fs.writeFile(path.join(DATA_DIR, u.id, "snapshot.json"), JSON.stringify(s));
      console.log(`  ${u.id}: updated ${n} stocks`);
    }
  }
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
