/**
 * Repair pass for per-symbol price history. The big chart fetch in build-data.ts
 * gets rate-limited deep into the ~3,000-symbol run, leaving some snapshot names with
 * an EMPTY daily series → "No price history" on the chart even though the quote (price,
 * metrics) came through. This re-fetches the daily (and intraday, where needed) charts
 * for ONLY the symbols whose series is missing/empty, with retry+backoff, and writes
 * just the ones that come back with data — genuinely delisted/junk tickers stay empty.
 * Runs as a workflow repair step after refresh-data, and on demand:
 *
 *   npm run refresh-series
 */
import { promises as fs } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { UNIVERSES } from "../lib/universes";
import { symbolFile } from "../lib/symbolfile";
import type { Snapshot, SeriesPoint, XY } from "../lib/types";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA_DIR = path.join(process.cwd(), "data");
const SYMBOL_DIR = path.join(DATA_DIR, "series", "symbols");
const DAY = 86_400_000;
const NOW = Date.now();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const round2 = (n: number) => Math.round(n * 100) / 100;
const toPoints = (quotes: any[]): SeriesPoint[] =>
  (quotes || []).filter((q) => q && q.close != null && q.date).map((q) => ({ t: new Date(q.date).getTime(), c: q.close as number })).sort((a, b) => a.t - b.t);
const toXY = (pts: SeriesPoint[]): XY[] => pts.map((p) => [p.t, round2(p.c)]);

async function mapPool<T, R>(items: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
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
  // union of snapshot symbols + which universes want intraday
  const intradayUniverses = new Set(UNIVERSES.filter((u) => (u as any).intraday).map((u) => u.id));
  const syms = new Set<string>();
  const needIntraday = new Set<string>();
  for (const u of UNIVERSES) {
    try {
      const snap = JSON.parse(await fs.readFile(path.join(DATA_DIR, u.id, "snapshot.json"), "utf8")) as Snapshot;
      for (const st of snap.stocks) {
        syms.add(st.symbol);
        if (intradayUniverses.has(u.id)) needIntraday.add(st.symbol);
      }
    } catch {
      /* not built */
    }
  }

  // which of them have a missing or empty daily series
  const targets: string[] = [];
  for (const sym of syms) {
    try {
      const d = JSON.parse(await fs.readFile(path.join(SYMBOL_DIR, symbolFile(sym)), "utf8"));
      if (!Array.isArray(d.daily) || d.daily.length === 0) targets.push(sym);
    } catch {
      targets.push(sym); // missing file
    }
  }
  console.log(`${syms.size} snapshot symbols; ${targets.length} with empty/missing series — refetching…`);

  const dailyPeriod1 = new Date(NOW - 2010 * DAY); // ~5.5y, matches build-data
  const intradayPeriod1 = new Date(NOW - 8 * DAY);
  let fixed = 0, dead = 0, done = 0;
  await mapPool(targets, 8, async (sym) => {
    let pts: SeriesPoint[] = [];
    for (let attempt = 0; attempt < 3 && pts.length === 0; attempt++) {
      if (attempt > 0) await sleep(400 + attempt * 600); // backoff past a rate-limit
      try {
        const ch: any = await yf.chart(sym, { period1: dailyPeriod1, interval: "1d" }, { validateResult: false });
        pts = toPoints(ch?.quotes);
      } catch {
        /* retry */
      }
    }
    if (pts.length === 0) { dead++; if (++done % 200 === 0) console.log(`  ${done}/${targets.length}`); return; } // delisted/junk — leave empty

    let intraday: XY[] = [];
    if (needIntraday.has(sym)) {
      try {
        const ch: any = await yf.chart(sym, { period1: intradayPeriod1, interval: "15m", includePrePost: false }, { validateResult: false });
        intraday = toXY(toPoints(ch?.quotes));
      } catch {
        /* optional */
      }
    }
    await fs.writeFile(path.join(SYMBOL_DIR, symbolFile(sym)), JSON.stringify({ daily: toXY(pts), intraday }));
    fixed++;
    if (++done % 200 === 0) console.log(`  ${done}/${targets.length} (${fixed} backfilled)`);
  });

  console.log(`\nDone. ${fixed} series backfilled, ${dead} still empty (delisted / no data on Yahoo).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
