/**
 * refresh-sector-trend — the sector valuation lens: the SAME log-linear trend channel as the index
 * model (lib/trendChannel), applied to the 11 GICS sector ETFs (Yahoo monthly since their ~1998
 * inception; XLRE/XLC are younger). Sorted cheapest→dearest so the valuation extremes pop. Writes
 * data/sector-trend.json; the Macro "Valuation" tab renders it under the indices.
 *
 * Free data (Yahoo). Descriptive, not predictive; the sector-ETF history is shorter than the S&P's
 * deep series, so the fits span fewer cycles — a stated caveat. Degrades to STALE (writeFeedGuarded).
 *
 *   npx tsx scripts/refresh-sector-trend.ts
 */
import { yahoo } from "../lib/yahooClient";
import { writeFeedGuarded } from "../lib/feedGuard";
import { buildTrendChannel, type TrendObs } from "../lib/trendChannel";
import { SECTORS } from "../lib/sectors";
import type { IndexTrend, IndexTrendData } from "../lib/indexTrend";

async function fetchMonthly(sym: string): Promise<TrendObs[]> {
  const r: any = await yahoo.chart(sym, { period1: new Date("1998-01-01"), interval: "1mo" }, { validateResult: false });
  const out: TrendObs[] = [];
  for (const q of r?.quotes || []) if (q?.date && q.close != null) out.push({ t: new Date(q.date).getTime(), price: q.close });
  return out;
}

async function currentQuote(sym: string): Promise<TrendObs | null> {
  try {
    const q: any = await yahoo.quote(sym, {}, { validateResult: false });
    if (q?.regularMarketPrice == null) return null;
    return { t: q?.regularMarketTime ? new Date(q.regularMarketTime).getTime() : Date.now(), price: q.regularMarketPrice };
  } catch { return null; }
}

async function main() {
  const out: IndexTrend[] = [];
  for (const s of SECTORS) {
    let series: TrendObs[] = [];
    try { series = await fetchMonthly(s.etf); } catch (e: any) { console.warn(`  ${s.etf}: history fetch failed (${String(e?.message || e).slice(0, 50)})`); }
    const it = buildTrendChannel(
      { key: s.etf.toLowerCase(), label: s.name, symbol: s.etf, source: "Yahoo · SPDR sector ETF (from ~1998)" },
      series, await currentQuote(s.etf),
    );
    if (it) { out.push(it); console.log(`  ${s.etf.padEnd(5)} ${s.name.padEnd(24)} z ${it.z.toFixed(2)} ${it.verdict.padEnd(10)} ${it.pctFromTrend >= 0 ? "+" : ""}${it.pctFromTrend.toFixed(0)}% | ${it.nMonths}mo since ${it.startYear}`); }
    else console.warn(`  ${s.etf}: insufficient data — skipped`);
  }
  out.sort((a, b) => a.z - b.z); // cheapest → dearest: the valuation-extreme lens

  const data: IndexTrendData = { asOf: new Date().toISOString(), indices: out };
  const w = await writeFeedGuarded("sector-trend.json", data);
  console.log(`refresh-sector-trend: ${w.reason}`);
  if (!w.written) { console.error("refresh-sector-trend: kept prior file (too thin) — retry next tick."); process.exitCode = 1; }
}

main().catch((e) => { console.error("refresh-sector-trend:", String((e as Error)?.message || e)); process.exitCode = 1; });
