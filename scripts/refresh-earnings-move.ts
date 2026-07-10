/**
 * Builds data/earnings-move.json — the earnings expected-move screen.
 *
 * 1. Find US names reporting within the next ~16 days (snapshot earningsDate), > $250M cap —
 *    plus a live recheck of names whose date RECENTLY PASSED (a moved print leaves a stale date).
 * 2. For each, pull the option chain at the expiry just AFTER the report (STRICTLY after for an
 *    after-close print — same-day options die at 4pm, before the print), price the ATM straddle
 *    → implied move % (straddle / spot) and the implied vol the straddle bakes in.
 * 3. Pull the last ~8 post-earnings one-day reactions (lib/earningsReaction) → historical average
 *    move. Richness = implied / historical: >1 the options price the event richer than history.
 * 4. CARRY-FORWARD: a name whose event is still ahead but whose repricing failed tonight keeps
 *    yesterday's row — one bad chain fetch must never delete tomorrow's reporter from the board
 *    (DAL vanished the night before its print, 2026-07-10).
 *
 * Run: npm run refresh-earnings-move. Wired into the nightly FULL refresh.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { loadSnapshot } from "../lib/data";
import { getOptions } from "../lib/options";
import { getEarningsReactions } from "../lib/earningsReaction";
import type { EarningsMoveData, EarningsMoveRow } from "../lib/earningsMove";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);

const DATA = path.join(process.cwd(), "data");
const US_UNIVERSES = ["russell3000", "sp1500", "russell1000", "nasdaq100", "sp500"];
const WINDOW = 16; // days ahead to include
// $250M floor (was $1B): the user's small-cap reporters (KRUS/HELE-class, ~$600M) were invisible.
// CAP still bounds the options-fetch cost; the pool is soonest-first so near prints always make it.
const MIN_MKTCAP = 2.5e8;
const CAP = 260; // most names processed (soonest first); truncation is LOGGED, never silent
// Snapshot earningsDates go stale when a company MOVES its print (Yahoo had KRUS on Jul 7; the real
// print was Jul 10 — the date "passed" and the name vanished). For dates that recently passed, one
// live calendarEvents call rechecks; if the fresh date is inside the window, the name comes back.
const STALE_LOOKBACK_D = 6;
const STALE_RECHECK_CAP = 40;

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
  const DAY = 86_400_000;
  // Calendar-day diff with BOTH sides floored to their UTC day (the 10f4c822 class): a today-BMO
  // print at the ~01:30 UTC build is day 0, never −1; an AMC print stays on its calendar day.
  const nowDay = Math.floor(now / DAY);
  const calDays = (epochMs: number) => Math.floor(epochMs / DAY) - nowDay;

  const seen = new Set<string>();
  const pool: any[] = [];
  const stale: any[] = []; // date recently passed → maybe a MOVED print; recheck live below
  for (const uni of US_UNIVERSES) {
    const snap = await loadSnapshot(uni);
    if (!snap) continue;
    for (const s of snap.stocks) {
      if (seen.has(s.symbol)) continue;
      const e = s.earningsDate ? Date.parse(s.earningsDate) : NaN;
      if (!Number.isFinite(e)) continue;
      if (!(s.marketCap > MIN_MKTCAP)) continue;
      const days = calDays(e);
      if (days >= 0 && days <= WINDOW) {
        seen.add(s.symbol);
        pool.push({ ...s, _days: days, _e: e });
      } else if (days >= -STALE_LOOKBACK_D && days < 0) {
        stale.push(s);
      }
    }
  }

  // Live recheck of recently-passed dates (bounded): a company that MOVED its print leaves the
  // snapshot pointing at the old date. One calendarEvents call per candidate; a fresh in-window
  // date re-admits the name (KRUS: snapshot said Jul 7, real print Jul 10).
  stale.sort((a, b) => b.marketCap - a.marketCap);
  const recheck = stale.slice(0, STALE_RECHECK_CAP);
  let readmitted = 0;
  for (const s of recheck) {
    try {
      const qs: any = await yf.quoteSummary(s.symbol, { modules: ["calendarEvents"] } as any, { validateResult: false });
      const ed = qs?.calendarEvents?.earnings?.earningsDate;
      const first = Array.isArray(ed) ? ed[0] : ed;
      const e = first instanceof Date ? first.getTime() : Date.parse(String(first ?? ""));
      if (!Number.isFinite(e)) continue;
      const days = calDays(e);
      if (days >= 0 && days <= WINDOW && !seen.has(s.symbol)) {
        seen.add(s.symbol);
        pool.push({ ...s, earningsDate: new Date(e).toISOString(), _days: days, _e: e });
        readmitted++;
      }
    } catch { /* keep going */ }
  }
  if (stale.length) console.log(`stale-date recheck: ${recheck.length}/${stale.length} recently-passed dates requeried → ${readmitted} re-admitted (moved prints)`);

  pool.sort((a, b) => a._days - b._days);
  const work = pool.slice(0, CAP);
  if (pool.length > CAP) console.log(`⚠ pool ${pool.length} > CAP ${CAP} — the ${pool.length - CAP} farthest-dated names are deferred to a later run (soonest-first kept)`);
  console.log(`${pool.length} US names report within ${WINDOW}d (>$${(MIN_MKTCAP / 1e6).toFixed(0)}M) → processing ${work.length}`);

  const built = await mapPool(work, 6, async (s) => {
    const sym: string = s.symbol;
    const base = await chainRetry(sym);
    const spot = base.underlying ?? s.price ?? null;
    if (!spot || !base.expirations.length) return null;

    // Expiry just after the earnings date (captures the event). Two rules from the BMNR/DAL bugs:
    // an AFTER-CLOSE print needs an expiry STRICTLY after the report day (same-day options die at
    // the close, hours BEFORE the print), and if the picked expiry is already <1 day out at build
    // time, ADVANCE to the next expiry instead of dropping the name — `return null` here deleted
    // every today/tomorrow reporter from the board the night before their print.
    const eIso = new Date(s._e).toISOString().slice(0, 10);
    const amc = new Date(s._e).getUTCHours() >= 20; // ≥20:00 UTC ≈ post-4pm-ET print
    let expIdx = base.expirations.findIndex((d: string) => (amc ? d > eIso : d >= eIso));
    if (expIdx === -1) expIdx = base.expirations.length - 1;
    let exp = base.expirations[expIdx];
    let dte = Math.round((Date.parse(exp + "T00:00:00Z") - now) / 86_400_000);
    if (dte < 1 && expIdx + 1 < base.expirations.length) {
      exp = base.expirations[expIdx + 1];
      dte = Math.round((Date.parse(exp + "T00:00:00Z") - now) / 86_400_000);
    }
    if (dte < 1) return null; // no future expiry at all — nothing to price
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

  // CARRY-FORWARD: a still-future reporter that priced YESTERDAY but failed tonight (one flaky chain
  // fetch) keeps its prior row — a day-old straddle beats vanishing from the board the night before
  // the print. Past-dated prior rows are dropped as before; daysToEarnings is re-anchored to today.
  let carried = 0;
  try {
    const prior: EarningsMoveData = JSON.parse(await fsp.readFile(path.join(DATA, "earnings-move.json"), "utf8"));
    const have = new Set(rows.map((r) => r.symbol));
    for (const r of prior.rows ?? []) {
      const e = Date.parse(r.earningsDate);
      if (!Number.isFinite(e) || have.has(r.symbol)) continue;
      const days = calDays(e);
      if (days < 0 || days > WINDOW) continue;
      rows.push({ ...r, daysToEarnings: days });
      carried++;
    }
    if (carried) rows.sort((a, b) => a.daysToEarnings - b.daysToEarnings);
  } catch { /* first run / no prior file */ }
  if (carried) console.log(`carried forward ${carried} still-future rows whose repricing failed tonight`);

  const data: EarningsMoveData = {
    generatedAt: new Date().toISOString(),
    source: "US names reporting within ~2 weeks (>$250M)",
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
