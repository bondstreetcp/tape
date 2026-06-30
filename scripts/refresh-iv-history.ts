/**
 * IV / pre-earnings-straddle history accumulator → data/iv-history.json.
 *
 * Each run snapshots, for every US name within ±5 days of its earnings date, the front-expiry ATM
 * straddle → straddle-implied move + the IV it bakes in (√(2/π) inversion, sturdier than vendor iv).
 * Run DAILY so the day-before and day-after snapshots bracket each print — that's what lets lib/ivHistory
 * later compute the realized IV crush, IV-rank, and a true long-premium backtest. Pure forward
 * accumulation: it builds value over earnings cycles, nothing to backfill.
 *
 * Run: npm run refresh-iv-history. Wired into the nightly run.
 */
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot } from "../lib/data";
import { getOptions } from "../lib/options";
import type { IvHistoryData, IvSnapshot } from "../lib/ivHistory";

const OUT = path.join(process.cwd(), "data", "iv-history.json");
const US_UNIVERSES = ["russell3000", "sp1500", "russell1000", "nasdaq100", "sp500"];
const WINDOW = 5; // days each side of the earnings date
const MIN_MKTCAP = 1e9;
const CAP = 220; // most names snapshotted per run
const KEEP = 600; // snapshots kept per ticker (~ several earnings windows)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; try { out[i] = await fn(items[i]); } catch { out[i] = null as any; } }
  }));
  return out;
}

async function main() {
  const now = Date.now();
  const today = new Date(now).toISOString().slice(0, 10);
  const seen = new Set<string>();
  const pool: { symbol: string; days: number }[] = [];
  for (const uni of US_UNIVERSES) {
    const snap = await loadSnapshot(uni);
    if (!snap) continue;
    for (const s of snap.stocks) {
      if (seen.has(s.symbol)) continue;
      const e = s.earningsDate ? Date.parse(s.earningsDate) : NaN;
      if (!Number.isFinite(e)) continue;
      const days = Math.round((e - now) / 86_400_000); // + before, − after
      if (Math.abs(days) > WINDOW) continue;
      if (!(s.marketCap > MIN_MKTCAP)) continue;
      seen.add(s.symbol);
      pool.push({ symbol: s.symbol, days });
    }
  }
  pool.sort((a, b) => Math.abs(a.days) - Math.abs(b.days)); // closest to the print first
  const work = pool.slice(0, CAP);
  console.log(`${pool.length} US names within ±${WINDOW}d of earnings → snapshotting ${work.length}`);

  const data: IvHistoryData = await fsp.readFile(OUT, "utf8").then((s) => JSON.parse(s)).catch(() => ({ generatedAt: "", byTicker: {} }));

  let took = 0;
  const snaps = await mapPool(work, 6, async (w): Promise<{ sym: string; snap: IvSnapshot } | null> => {
    await sleep(120);
    const base = await getOptions(w.symbol).catch(() => null);
    const spot = base?.underlying ?? null;
    if (!base || !spot || !base.expirations.length) return null;
    const exp = base.selected ?? base.expirations[0];
    const dte = exp ? Math.round((Date.parse(exp + "T00:00:00Z") - now) / 86_400_000) : null;
    const strikes = [...new Set([...base.calls, ...base.puts].map((o) => o.strike))];
    if (!strikes.length) return null;
    const atm = strikes.reduce((a, b) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a));
    const mid = (o: any) => (o && o.bid && o.ask ? (o.bid + o.ask) / 2 : o?.last) || 0;
    const straddle = mid(base.calls.find((o) => o.strike === atm)) + mid(base.puts.find((o) => o.strike === atm));
    if (!(straddle > 0)) return null;
    const movePct = (straddle / spot) * 100;
    const T = dte != null && dte > 0 ? dte / 365 : null;
    const atmIV = T ? straddle / (0.7978845608 * spot * Math.sqrt(T)) : null;
    return { sym: w.symbol, snap: { date: today, atmIV: atmIV != null ? +atmIV.toFixed(3) : null, movePct: +movePct.toFixed(2), spot: +spot.toFixed(2), dte, daysToEarnings: w.days } };
  });

  for (const r of snaps) {
    if (!r) continue;
    const arr = (data.byTicker[r.sym] ||= []);
    const ix = arr.findIndex((s) => s.date === r.snap.date);
    if (ix >= 0) arr[ix] = r.snap; else arr.push(r.snap); // one snapshot per ticker per day
    if (arr.length > KEEP) arr.splice(0, arr.length - KEEP);
    took++;
  }
  data.generatedAt = new Date().toISOString();
  await fsp.writeFile(OUT, JSON.stringify(data));
  console.log(`snapshotted ${took} names · ${Object.keys(data.byTicker).length} tickers in the history file`);
}

main().catch((e) => { console.error(e); process.exit(1); });
