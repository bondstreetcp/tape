/**
 * Market betas — regresses each US name's daily log-returns on ^GSPC's over ~5y → data/betas.json. Powers
 * the Portfolio cockpit's beta-weighted exposure + market-shock scenario. Pure local math off the stored
 * price series (+ one ^GSPC fetch); no LLM. Nightly (FULL). Beta math is lib/pairs.computeBeta (tested).
 *
 * Window = 5y (LOOKBACK) on purpose: over the trailing 1–2y this dataset's index is dominated by a handful
 * of mega-cap AI names, so defensives (KO/DUK/JNJ) print near-zero / negative short-run betas — mathematically
 * true but counterintuitive for a risk tool. The 5y window (also the industry-standard beta horizon) restores
 * sensible, positive-if-low defensive betas without hand-tuning.
 *
 * The stored series and Yahoo's ^GSPC use different intraday timestamps, so both are DAY-BUCKETED (one
 * close per calendar day) before aligning — else the exact-timestamp alignment finds no overlap.
 */
import { writeFeedGuarded } from "../lib/feedGuard";
import { promises as fs } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { computeBeta, bucketByDay, type Daily } from "../lib/pairs";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const DAY = 86_400_000;

async function loadSeries(sym: string): Promise<Daily | null> {
  try {
    const j = JSON.parse(await fs.readFile(path.join(DATA, "series", "symbols", sym + ".json"), "utf8"));
    return Array.isArray(j?.daily) ? (j.daily as Daily) : null;
  } catch { return null; }
}

async function main() {
  const chart: any = await yf
    .chart("^GSPC", { period1: new Date(Date.now() - 1900 * DAY), interval: "1d" }, { validateResult: false } as any)
    .catch(() => null);
  const market = bucketByDay(((chart?.quotes ?? []) as any[]).filter((q) => q?.close != null && q?.date).map((q) => [new Date(q.date).getTime(), q.close] as [number, number]));
  if (market.length < 120) { console.error("betas: no ^GSPC market series — aborting (keep previous file)"); process.exit(1); }
  console.log(`betas: market (^GSPC) ${market.length} days`);

  // Persist the market series too — the Portfolio cockpit's risk read splits the book's predicted
  // volatility into systematic (market) vs stock-specific by regressing on this (lib/portfolioRisk).
  const mw = await writeFeedGuarded("market.json", { generatedAt: new Date().toISOString(), symbol: "^GSPC", daily: market });
  if (!mw.written) console.error(`refresh-betas: market.json write blocked — ${mw.reason}`);

  const syms = new Set<string>();
  for (const u of ["sp500", "nasdaq100", "russell1000"]) {
    try {
      const j = JSON.parse(await fs.readFile(path.join(DATA, u, "snapshot.json"), "utf8"));
      for (const s of j.stocks ?? []) if (s.symbol) syms.add(s.symbol);
    } catch { /* skip */ }
  }

  const betas: Record<string, number> = {};
  let missing = 0;
  for (const sym of syms) {
    const d = await loadSeries(sym);
    if (!d) { missing++; continue; }
    const b = computeBeta(bucketByDay(d), market, 1300); // ~5y of trading days
    if (b != null) betas[sym] = Math.round(b * 1000) / 1000;
  }
  // Guarded: a vendor-outage night must leave the prior betas stale, not blank (see lib/feedGuard).
  const w = await writeFeedGuarded("betas.json", { generatedAt: new Date().toISOString(), market: "^GSPC", betas });
  if (!w.written) { console.error(`refresh-betas: WRITE BLOCKED — ${w.reason}`); process.exit(1); }
  console.log(`betas: wrote ${Object.keys(betas).length} betas (${missing} names had no series)`);
}

main().catch((e) => { console.error("betas:", String(e?.message || e)); process.exit(1); });
