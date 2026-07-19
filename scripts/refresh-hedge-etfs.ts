/**
 * ETF series + meta for the Portfolio cockpit's hedge optimizer AND what-if. Fetches the liquid hedge
 * menu (lib/hedge.HEDGE_ETFS) → data/series/symbols/<ETF>.json (for the optimizer's return matrix) and
 * writes data/etf-meta.json {symbol: {name, price, beta}} so /api/portfolio can PRICE the ETFs (they're
 * not in the stock snapshots) — which lets the optimizer's legs apply to the what-if simulator. Betas are
 * regressed on ^GSPC (data/market.json, written by refresh-betas which runs first). Flows to R2 with data/.
 */
import { promises as fs } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { HEDGE_ETFS } from "../lib/hedge";
import { computeBeta, bucketByDay, type Daily } from "../lib/pairs";
import { sliceSeries, seriesChangePct } from "../lib/compute";
import { TIMEFRAME_KEYS } from "../lib/timeframes";

/** Timeframe returns (%) from a daily series, via the app's canonical slice+change (lib/compute), so an
 *  ETF's return reads the same way as a stock's. `now` = the last bar, so it's as-of the data date. */
function etfReturns(daily: [number, number][]): Record<string, number | null> {
  const pts = daily.map(([t, c]) => ({ t, c }));
  const now = daily.length ? daily[daily.length - 1][0] : 0;
  const out: Record<string, number | null> = {};
  for (const tf of TIMEFRAME_KEYS) out[tf] = seriesChangePct(sliceSeries(pts, pts, tf, now));
  return out;
}

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DAY = 86_400_000;
const DATA = path.join(process.cwd(), "data");
const DIR = path.join(DATA, "series", "symbols");

async function fetchDaily(sym: string): Promise<[number, number][] | null> {
  const chart: any = await yf
    .chart(sym, { period1: new Date(Date.now() - 1900 * DAY), interval: "1d" }, { validateResult: false } as any)
    .catch((e: any) => { console.error(`hedge-etfs: ${sym} fetch failed — ${e?.message}`); return null; });
  const daily = ((chart?.quotes ?? []) as any[])
    .filter((q) => q?.close != null && q?.date)
    .map((q) => [new Date(q.date).getTime(), q.close] as [number, number]);
  return daily.length >= 120 ? daily : null;
}

async function loadMarket(): Promise<Daily | null> {
  try {
    const j = JSON.parse(await fs.readFile(path.join(DATA, "market.json"), "utf8"));
    return Array.isArray(j?.daily) ? (j.daily as Daily) : null;
  } catch { return null; }
}

async function main() {
  await fs.mkdir(DIR, { recursive: true });
  const market = await loadMarket();
  if (!market) console.error("hedge-etfs: no data/market.json — ETF betas will be null (run refresh-betas first)");

  const meta: Record<string, { name: string; price: number; beta: number | null; returns: Record<string, number | null> }> = {};
  let ok = 0, fail = 0;
  for (const { etf, name } of HEDGE_ETFS) {
    const daily = await fetchDaily(etf);
    if (!daily) { console.error(`hedge-etfs: ${etf} — no series (kept previous if any)`); fail++; continue; }
    await fs.writeFile(path.join(DIR, etf + ".json"), JSON.stringify({ daily, intraday: [] }));
    const price = daily[daily.length - 1][1];
    const beta = market ? computeBeta(bucketByDay(daily), market, 1300) : null;
    meta[etf] = { name, price, beta: beta != null ? Math.round(beta * 1000) / 1000 : null, returns: etfReturns(daily) };
    ok++;
    console.log(`hedge-etfs: ${etf} ${daily.length}d  px ${price.toFixed(2)}  β ${beta != null ? beta.toFixed(2) : "—"}  ytd ${meta[etf].returns.ytd?.toFixed(1) ?? "—"}%`);
  }
  if (ok > 0) await fs.writeFile(path.join(DATA, "etf-meta.json"), JSON.stringify({ generatedAt: new Date().toISOString(), etfs: meta }));
  console.log(`hedge-etfs: wrote ${ok}/${HEDGE_ETFS.length} series + etf-meta (${fail} failed)`);
  if (ok === 0) process.exit(1);
}
main();
