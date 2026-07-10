/**
 * Builds data/signal-backtest.json — the historical companion to the live Signal Track Record.
 * Loads every S&P 500 member's stored daily series and runs lib/signalBacktest's pure engine:
 * monthly rebalances over ~5y for the PRICE-RECONSTRUCTIBLE signals (Leaders RS, breakout tag,
 * 12−1 momentum, RSI oversold), graded 1w/1m/3m forward against the same-day equal-weight pool.
 * All local math over already-stored series — no network, no LLM. Run: npm run backtest-signals.
 * Nightly FULL (new month-end points + recent forward windows fill in as bars arrive).
 */
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot, loadSymbolSeries } from "../lib/data";
import { runBacktest } from "../lib/signalBacktest";

const OUT = path.join(process.cwd(), "data", "signal-backtest.json");

async function main() {
  const snap = await loadSnapshot("sp500");
  if (!snap?.stocks?.length) throw new Error("sp500 snapshot missing — hydrate data/ first");
  const series = new Map<string, [number, number][]>();
  for (const s of snap.stocks) {
    const ser = await loadSymbolSeries(s.symbol).catch(() => null);
    const daily = ser?.daily;
    if (Array.isArray(daily) && daily.length >= 320) series.set(s.symbol, daily as [number, number][]);
  }
  console.log(`backtest-signals: ${series.size}/${snap.stocks.length} S&P 500 names have ≥320 stored daily bars`);
  const result = runBacktest(series, "sp500");
  if (!result) throw new Error("backtest produced no result (not enough aligned history)");
  await fsp.writeFile(OUT, JSON.stringify(result));
  console.log(`wrote ${result.rebalances} rebalances ${result.start} → ${result.end} over ${result.names} names`);
  for (const sig of result.signals) {
    const m1 = sig.horizons.m1;
    console.log(`  ${sig.label.padEnd(28)} 1m edge ${m1 ? (m1.edge >= 0 ? "+" : "") + m1.edge.toFixed(2) + "pp" : "—"}  hit ${m1 ? Math.round(m1.hit * 100) + "%" : "—"}  (n=${m1?.n ?? 0}, ~${sig.avgPicks} picks/reb)`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
