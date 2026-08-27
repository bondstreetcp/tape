/**
 * refresh-index-trend — the long-run index valuation model: OLS-fit ln(price) on time for the S&P 500
 * (deep history since 1932), Nasdaq Composite and Russell 2000, then draw ±1σ/±2σ residual bands around
 * the exponential trend. Where price sits in the channel (z-score) = how cheap/dear the market is vs its
 * own long-term growth trend. Writes data/index-trend.json; the Macro "Valuation" tab renders it.
 *
 * Free data: S&P deep monthly from the Shiller/datahub CSV (since 1871; we fit from 1932), bridged to
 * today with Yahoo ^GSPC; Nasdaq/Russell from Yahoo monthly (their modern history). Degrades to STALE
 * (writeFeedGuarded). Descriptive, not predictive — sensitive to the start year (a stated caveat).
 *
 *   npx tsx scripts/refresh-index-trend.ts
 */
import { yahoo } from "../lib/yahooClient";
import { writeFeedGuarded } from "../lib/feedGuard";
import { buildTrendChannel, type TrendObs } from "../lib/trendChannel";
import type { IndexTrend, IndexTrendData } from "../lib/indexTrend";

const UA = { "User-Agent": "stock-chart-screener (research)" };
const SHILLER_CSV = "https://raw.githubusercontent.com/datasets/s-and-p-500/master/data/data.csv";

type Obs = TrendObs;
type Cfg = { key: string; label: string; quoteSym: string; deep: boolean; sinceYear?: number; source: string };

const INDICES: Cfg[] = [
  { key: "sp500", label: "S&P 500", quoteSym: "^GSPC", deep: true, sinceYear: 1932, source: "Shiller/datahub since 1932 + Yahoo" },
  { key: "nasdaq", label: "Nasdaq Composite", quoteSym: "^IXIC", deep: false, source: "Yahoo (from 1985)" },
  { key: "russell2000", label: "Russell 2000", quoteSym: "^RUT", deep: false, source: "Yahoo (from 1987)" },
];

async function fetchShiller(sinceYear: number): Promise<Obs[]> {
  const res = await fetch(SHILLER_CSV, { headers: UA, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) throw new Error(`shiller HTTP ${res.status}`);
  const out: Obs[] = [];
  for (const ln of (await res.text()).trim().split(/\r?\n/).slice(1)) {
    const c = ln.split(",");
    const t = Date.parse(c[0]), price = parseFloat(c[1]);
    if (Number.isFinite(t) && price > 0 && new Date(t).getUTCFullYear() >= sinceYear) out.push({ t, price });
  }
  return out;
}

async function fetchYahooMonthly(sym: string): Promise<Obs[]> {
  const r: any = await yahoo.chart(sym, { period1: new Date("1970-01-01"), interval: "1mo" }, { validateResult: false });
  const out: Obs[] = [];
  for (const q of r?.quotes || []) if (q?.date && q.close != null) out.push({ t: new Date(q.date).getTime(), price: q.close });
  return out;
}

async function currentQuote(sym: string): Promise<Obs | null> {
  try {
    const q: any = await yahoo.quote(sym, {}, { validateResult: false });
    if (q?.regularMarketPrice == null) return null;
    return { t: q?.regularMarketTime ? new Date(q.regularMarketTime).getTime() : Date.now(), price: q.regularMarketPrice };
  } catch { return null; }
}

async function main() {
  const indices: IndexTrend[] = [];
  for (const cfg of INDICES) {
    let series: Obs[] = [];
    try { series = cfg.deep ? await fetchShiller(cfg.sinceYear!) : await fetchYahooMonthly(cfg.quoteSym); }
    catch (e: any) { console.warn(`  ${cfg.key}: history fetch failed (${String(e?.message || e).slice(0, 60)})`); }
    if (cfg.deep && series.length) { // bridge the datahub tail lag with recent Yahoo monthly
      try { const last = series[series.length - 1].t; for (const o of await fetchYahooMonthly(cfg.quoteSym)) if (o.t > last) series.push(o); } catch { /* bridge best-effort */ }
    }
    const it = buildTrendChannel({ key: cfg.key, label: cfg.label, symbol: cfg.quoteSym, source: cfg.source }, series, await currentQuote(cfg.quoteSym));
    if (it) { indices.push(it); console.log(`  ${cfg.key.padEnd(12)} ${it.current.toFixed(0)} | trend ${it.trendNow.toFixed(0)} | ${it.pctFromTrend >= 0 ? "+" : ""}${it.pctFromTrend.toFixed(0)}% (z ${it.z.toFixed(2)}) → ${it.verdict} | CAGR ${it.cagrPct.toFixed(1)}% | ${it.nMonths}mo since ${it.startYear}`); }
    else console.warn(`  ${cfg.key}: insufficient data — skipped`);
  }
  const data: IndexTrendData = { asOf: new Date().toISOString(), indices };
  const w = await writeFeedGuarded("index-trend.json", data);
  console.log(`refresh-index-trend: ${w.reason}`);
  if (!w.written) { console.error("refresh-index-trend: kept prior file (too thin) — retry next tick."); process.exitCode = 1; }
}

main().catch((e) => { console.error("refresh-index-trend:", String((e as Error)?.message || e)); process.exitCode = 1; });
