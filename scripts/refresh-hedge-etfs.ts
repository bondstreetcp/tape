/**
 * ETF series for the Portfolio cockpit's hedge OPTIMIZER — fetch the liquid hedge menu
 * (lib/hedge.HEDGE_ETFS) and write each as a standard data/series/symbols/<ETF>.json so the risk route
 * loads them like any name and the client can solve the risk-minimizing overlay (lib/hedgeOptimizer).
 * Nightly-safe (a failed name keeps its previous file); flows to R2 with the rest of data/.
 */
import { promises as fs } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { HEDGE_ETFS } from "../lib/hedge";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DAY = 86_400_000;
const DIR = path.join(process.cwd(), "data", "series", "symbols");

async function fetchDaily(sym: string): Promise<[number, number][] | null> {
  const chart: any = await yf
    .chart(sym, { period1: new Date(Date.now() - 1900 * DAY), interval: "1d" }, { validateResult: false } as any)
    .catch((e: any) => { console.error(`hedge-etfs: ${sym} fetch failed — ${e?.message}`); return null; });
  const daily = ((chart?.quotes ?? []) as any[])
    .filter((q) => q?.close != null && q?.date)
    .map((q) => [new Date(q.date).getTime(), q.close] as [number, number]);
  return daily.length >= 120 ? daily : null;
}

async function main() {
  await fs.mkdir(DIR, { recursive: true });
  let ok = 0, fail = 0;
  for (const { etf } of HEDGE_ETFS) {
    const daily = await fetchDaily(etf);
    if (!daily) { console.error(`hedge-etfs: ${etf} — no series (kept previous if any)`); fail++; continue; }
    await fs.writeFile(path.join(DIR, etf + ".json"), JSON.stringify({ daily, intraday: [] }));
    ok++;
    console.log(`hedge-etfs: ${etf} ${daily.length} days`);
  }
  console.log(`hedge-etfs: wrote ${ok}/${HEDGE_ETFS.length} (${fail} failed)`);
  if (ok === 0) process.exit(1);
}
main();
