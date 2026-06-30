/**
 * Builds data/earnings-move.json — the earnings expected-move screen.
 *
 * 1. Find US names reporting within the next ~16 days (snapshot earningsDate), > $1B cap.
 * 2. For each, pull the option chain at the expiry just AFTER the report, price the ATM straddle
 *    → implied move % (straddle / spot) and the implied vol the straddle bakes in.
 * 3. Pull the last ~8 post-earnings one-day reactions (lib/earningsReaction) → historical average
 *    move. Richness = implied / historical: >1 the options price the event richer than history.
 *
 * Run: npm run refresh-earnings-move. Wired into the nightly FULL refresh.
 */
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot } from "../lib/data";
import { getOptions } from "../lib/options";
import { getEarningsReactions } from "../lib/earningsReaction";
import type { EarningsMoveData, EarningsMoveRow } from "../lib/earningsMove";

const DATA = path.join(process.cwd(), "data");
const US_UNIVERSES = ["russell3000", "sp1500", "russell1000", "nasdaq100", "sp500"];
const WINDOW = 16; // days ahead to include
const MIN_MKTCAP = 1e9;
const CAP = 130; // most names processed (soonest first)

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function mapPool<T, R2>(items: T[], n: number, fn: (x: T, i: number) => Promise<R2>): Promise<R2[]> {
  const out: R2[] = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        try { out[i] = await fn(items[i], i); } catch { out[i] = null as any; }
      }
    }),
  );
  return out;
}

let gate: Promise<void> = Promise.resolve();
function throttle(gap = 350): Promise<void> {
  const p = gate.then(() => sleep(gap));
  gate = p;
  return p;
}
async function chainRetry(sym: string, date?: string) {
  for (let i = 0; i < 4; i++) {
    await throttle();
    try { const c = await getOptions(sym, date); if (c.puts.length || c.calls.length || (!date && c.expirations.length)) return c; } catch { /* retry */ }
    await sleep(500 + i * 400);
  }
  await throttle();
  return getOptions(sym, date);
}

async function main() {
  const now = Date.now();
  const seen = new Set<string>();
  const pool: any[] = [];
  for (const uni of US_UNIVERSES) {
    const snap = await loadSnapshot(uni);
    if (!snap) continue;
    for (const s of snap.stocks) {
      if (seen.has(s.symbol)) continue;
      const e = s.earningsDate ? Date.parse(s.earningsDate) : NaN;
      if (!Number.isFinite(e)) continue;
      const days = Math.round((e - now) / 86_400_000);
      if (days < 0 || days > WINDOW) continue;
      if (!(s.marketCap > MIN_MKTCAP)) continue;
      seen.add(s.symbol);
      pool.push({ ...s, _days: days, _e: e });
    }
  }
  pool.sort((a, b) => a._days - b._days);
  const work = pool.slice(0, CAP);
  console.log(`${pool.length} US names report within ${WINDOW}d (>$${MIN_MKTCAP / 1e9}B) → processing ${work.length}`);

  const built = await mapPool(work, 6, async (s) => {
    const sym: string = s.symbol;
    const base = await chainRetry(sym);
    const spot = base.underlying ?? s.price ?? null;
    if (!spot || !base.expirations.length) return null;

    // expiry just after the earnings date (captures the event)
    const eIso = new Date(s._e).toISOString().slice(0, 10);
    const exp = base.expirations.find((d: string) => d >= eIso) ?? base.expirations[base.expirations.length - 1];
    const dte = Math.round((Date.parse(exp + "T00:00:00Z") - now) / 86_400_000);
    if (dte < 1) return null;
    const chain = exp === base.selected ? base : await chainRetry(sym, exp);
    const midOf = (o: any): number => (o && o.bid && o.ask ? (o.bid + o.ask) / 2 : o?.last) || 0;

    const allK = [...new Set([...chain.calls, ...chain.puts].map((o: any) => o.strike))];
    if (!allK.length) return null;
    const atmK = allK.reduce((a: number, b: number) => (Math.abs(b - spot) < Math.abs(a - spot) ? b : a));
    const c = chain.calls.find((o: any) => o.strike === atmK);
    const p = chain.puts.find((o: any) => o.strike === atmK);
    const straddle = midOf(c) + midOf(p);
    if (!(straddle > 0)) return null;
    const impliedMovePct = (straddle / spot) * 100;
    // ATM straddle ≈ √(2/π)·S·σ·√T  ⇒  σ ≈ straddle / (0.7979·S·√T) — sturdier than vendor iv
    const T = dte / 365;
    const impliedIV = T > 0 ? straddle / (0.7978845608 * spot * Math.sqrt(T)) : null;

    // historical post-earnings reactions
    let histAvgMovePct: number | null = null, histMaxMovePct: number | null = null, histN = 0;
    let beatUp: number | null = null, beatN = 0;
    let clearRate: number | null = null, clearN = 0;
    try {
      const rx = await getEarningsReactions(sym, 8);
      const moves = rx.map((r) => r.move).filter((m): m is number => m != null).map(Math.abs);
      if (moves.length) {
        histAvgMovePct = (moves.reduce((a, b) => a + b, 0) / moves.length) * 100;
        histMaxMovePct = Math.max(...moves) * 100;
        histN = moves.length;
        // long-premium win rate: how often the realized move EXCEEDED the move options price now
        clearN = moves.length;
        clearRate = moves.filter((m) => m > impliedMovePct / 100).length / moves.length;
      }
      // sell-the-news: of past EPS BEATS, how often the stock actually rose
      const beats = rx.filter((r) => r.surprise != null && r.surprise > 0 && r.move != null);
      beatN = beats.length;
      beatUp = beatN ? beats.filter((r) => (r.move as number) > 0).length / beatN : null;
    } catch { /* optional */ }
    const richness = histAvgMovePct && histAvgMovePct > 0 ? impliedMovePct / histAvgMovePct : null;

    const row: EarningsMoveRow = {
      symbol: sym, name: s.name, sector: s.sector || "—", price: spot, marketCap: s.marketCap,
      earningsDate: s.earningsDate, daysToEarnings: s._days, earningsEstimate: !!s.earningsEstimate,
      expiry: exp, dte, straddle: +straddle.toFixed(2), impliedMovePct: +impliedMovePct.toFixed(2),
      impliedIV: impliedIV != null ? +impliedIV.toFixed(3) : null,
      histAvgMovePct: histAvgMovePct != null ? +histAvgMovePct.toFixed(2) : null,
      histMaxMovePct: histMaxMovePct != null ? +histMaxMovePct.toFixed(2) : null,
      histN,
      richness: richness != null ? +richness.toFixed(2) : null,
      beatUp: beatUp != null ? +beatUp.toFixed(2) : null, beatN,
      clearRate: clearRate != null ? +clearRate.toFixed(2) : null, clearN,
    };
    return row;
  });

  const rows = built.filter((r): r is EarningsMoveRow => !!r).sort((a, b) => a.daysToEarnings - b.daysToEarnings);
  const data: EarningsMoveData = {
    generatedAt: new Date().toISOString(),
    source: "US large/mid caps reporting within ~2 weeks",
    windowDays: WINDOW,
    rows,
  };
  await fsp.writeFile(path.join(DATA, "earnings-move.json"), JSON.stringify(data));
  const withHist = rows.filter((r) => r.histAvgMovePct != null).length;
  console.log(`\nwrote ${rows.length} rows (${withHist} with reaction history).`);
  console.log("soonest reporters:");
  for (const r of rows.slice(0, 8)) {
    console.log(`  ${r.symbol.padEnd(6)} ${r.earningsDate.slice(0, 10)} (${r.daysToEarnings}d)  implied ±${r.impliedMovePct}%  hist ±${r.histAvgMovePct ?? "—"}%  rich ${r.richness ?? "—"}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
