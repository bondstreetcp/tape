/**
 * Builds data/trade-log.json — the TRACK RECORD for the Earnings-prep card's suggested plays.
 *
 * Two passes each night:
 *  1. LOG new plays. For US names reporting within ~12 days, reproduce EXACTLY the structure the card
 *     would suggest (lib/earningsTrade.buildEarningsTrade — same rich/cheap read, same strikes, same
 *     leg premiums) and record it with its expiry + entry premiums. One rec per name per print.
 *  2. SETTLE matured plays. Once a logged name has reported, record the realized 1-day move (did it
 *     clear what options priced?). Once its expiry passes, mark the underlying to that close, compute
 *     the structure's P&L held to expiry (options settle to intrinsic), and score win/loss/scratch.
 *
 * We can only track plays FORWARD — the entry premiums have to be captured live, before the print. A
 * play the user saw on the card yesterday can't be reconstructed unless it was logged that night.
 *
 * Run: npm run refresh-trade-log. Wired into the nightly FULL refresh.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { loadSnapshot } from "../lib/data";
import { getEarningsReactions } from "../lib/earningsReaction";
import { buildEarningsTrade } from "../lib/earningsTrade";
import { netCredit, payoffBounds, settleLegs, type TradeLogData, type TradeRec } from "../lib/tradeLog";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const FILE = path.join(DATA, "trade-log.json");
const US_UNIVERSES = ["russell3000", "sp1500", "russell1000", "nasdaq100", "sp500"];
const WINDOW = 12; // log names reporting within this many days
const MIN_MKTCAP = 1e9;
const CAP = 90; // most new names to price per run
const KEEP = 500; // recs to retain
const DAY = 86_400_000;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let gate: Promise<void> = Promise.resolve();
function throttle(gap = 300): Promise<void> {
  const p = gate.then(() => sleep(gap));
  gate = p;
  return p;
}
async function mapPool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
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

// Underlying close on the last trading day on/before `iso` (used to settle at expiry / read a reaction close).
async function closeOn(sym: string, iso: string): Promise<number | null> {
  const target = Date.parse(iso + "T00:00:00Z");
  if (!Number.isFinite(target)) return null;
  await throttle();
  const ch: any = await yf.chart(sym, { period1: new Date(target - 8 * DAY), period2: new Date(target + 4 * DAY), interval: "1d" } as any, { validateResult: false }).catch(() => null);
  const quotes = (ch?.quotes || []).filter((q: any) => q?.close != null);
  if (!quotes.length) return null;
  const onOrBefore = quotes.filter((q: any) => new Date(q.date).getTime() <= target + DAY);
  const pick = onOrBefore.length ? onOrBefore[onOrBefore.length - 1] : quotes[quotes.length - 1];
  return pick?.close ?? null;
}

function outcomeOf(pnl: number, entry: number): TradeRec["outcome"] {
  const eps = Math.max(0.03, 0.03 * Math.abs(entry)); // ~3c/share (or 3% of the ticket) counts as a scratch
  return pnl > eps ? "win" : pnl < -eps ? "loss" : "scratch";
}

async function main() {
  const now = Date.now();
  const nowISO = new Date(now).toISOString();
  const today = nowISO.slice(0, 10);

  // ── load existing log ──
  const existing: TradeLogData = await fsp
    .readFile(FILE, "utf8")
    .then((s) => JSON.parse(s) as TradeLogData)
    .catch(() => ({ generatedAt: nowISO, recs: [] as TradeRec[] }));
  const byId = new Map<string, TradeRec>(existing.recs.map((r) => [r.id, r]));

  // ── 1. LOG new plays for upcoming reporters ──
  const seen = new Set<string>();
  const pool: any[] = [];
  for (const uni of US_UNIVERSES) {
    const snap = await loadSnapshot(uni);
    if (!snap) continue;
    for (const s of snap.stocks) {
      if (seen.has(s.symbol)) continue;
      const e = s.earningsDate ? Date.parse(s.earningsDate) : NaN;
      if (!Number.isFinite(e)) continue;
      const days = Math.round((e - now) / DAY);
      if (days < 0 || days > WINDOW) continue;
      if (!(s.marketCap > MIN_MKTCAP)) continue;
      const id = `${s.symbol}-${new Date(e).toISOString().slice(0, 10)}`;
      if (byId.has(id)) { seen.add(s.symbol); continue; } // already logged this print
      seen.add(s.symbol);
      pool.push({ ...s, _days: days, _e: e, _id: id });
    }
  }
  pool.sort((a, b) => a._days - b._days);
  const work = pool.slice(0, CAP);
  console.log(`${pool.length} un-logged US names report within ${WINDOW}d → pricing ${work.length}`);

  let logged = 0;
  await mapPool(work, 5, async (s) => {
    const eIso = new Date(s._e).toISOString().slice(0, 10);
    await throttle();
    const built = await buildEarningsTrade(s.symbol, eIso).catch(() => null);
    if (!built || !built.trade.legsData) return;
    const legs = built.trade.legsData;
    const entry = netCredit(legs);
    const { maxProfit, maxLoss } = payoffBounds(legs);
    const rec: TradeRec = {
      id: s._id,
      symbol: s.symbol,
      name: s.name,
      sector: s.sector || undefined,
      loggedAt: nowISO,
      asOfDate: today,
      earningsDate: s.earningsDate,
      verdict: built.verdict,
      structure: built.trade.structure,
      legsText: built.trade.legs,
      expiry: built.trade.expiry || eIso,
      dte: built.trade.dte ?? Math.round((Date.parse((built.trade.expiry || eIso) + "T00:00:00Z") - now) / DAY),
      spotAtRec: +built.spot.toFixed(2),
      impliedMovePct: +built.impliedMovePct.toFixed(2),
      avgRealizedPct: +built.avgRealizedPct.toFixed(2),
      richnessRatio: +built.richnessRatio.toFixed(2),
      legs: legs.map((l) => ({ ...l, premium: +l.premium.toFixed(2) })),
      entryCredit: +entry.toFixed(2),
      maxProfit: maxProfit != null ? +maxProfit.toFixed(2) : null,
      maxLoss: maxLoss != null ? +maxLoss.toFixed(2) : null,
      status: "awaiting_print",
    };
    byId.set(rec.id, rec);
    logged++;
  });
  console.log(`logged ${logged} new plays`);

  // ── 2. SETTLE matured plays ──
  const openRecs = [...byId.values()].filter((r) => r.status !== "settled");
  let printed = 0, settled = 0;
  await mapPool(openRecs, 5, async (rec) => {
    const eT = Date.parse(rec.earningsDate);
    const expT = Date.parse(rec.expiry + "T00:00:00Z");

    // (a) print has happened → record the realized 1-day reaction if we don't have it yet
    if (rec.realizedMovePct == null && Number.isFinite(eT) && now >= eT) {
      await throttle();
      const rx = await getEarningsReactions(rec.symbol, 8).catch(() => []);
      let best: (typeof rx)[number] | null = null, bestGap = Infinity;
      for (const r of rx) {
        if (r.move == null) continue;
        const g = Math.abs(Date.parse(r.date) - eT);
        if (g < bestGap) { bestGap = g; best = r; }
      }
      if (best && bestGap <= 7 * DAY && best.move != null) {
        rec.realizedMovePct = +(best.move * 100).toFixed(2);
        rec.moveCleared = Math.abs(rec.realizedMovePct) > rec.impliedMovePct;
        if (rec.status === "awaiting_print") rec.status = "awaiting_expiry";
        printed++;
      }
    }

    // (b) expiry has passed (+1 session for the settle print) → mark to that close & score
    if (Number.isFinite(expT) && now >= expT + DAY) {
      const close = await closeOn(rec.symbol, rec.expiry);
      if (close != null) {
        const pnl = settleLegs(rec.legs, close);
        rec.spotAtExpiry = +close.toFixed(2);
        rec.pnl = +pnl.toFixed(2);
        rec.outcome = outcomeOf(pnl, rec.entryCredit);
        rec.settledAt = nowISO;
        rec.status = "settled";
        settled++;
      }
    }
  });
  console.log(`recorded ${printed} realized moves, settled ${settled} at expiry`);

  // ── prune + write ──
  const all = [...byId.values()].sort((a, b) => Date.parse(b.earningsDate) - Date.parse(a.earningsDate));
  const recs = all.slice(0, KEEP);
  const data: TradeLogData = { generatedAt: nowISO, recs };
  await fsp.writeFile(FILE, JSON.stringify(data));

  const open = recs.filter((r) => r.status !== "settled").length;
  const done = recs.filter((r) => r.status === "settled").length;
  const wins = recs.filter((r) => r.outcome === "win").length;
  console.log(`\nwrote ${recs.length} recs (${open} open, ${done} settled, ${wins} wins).`);
  for (const r of recs.slice(0, 8)) {
    const tag = r.status === "settled" ? `${r.outcome} ${r.pnl! >= 0 ? "+" : ""}${r.pnl}` : r.realizedMovePct != null ? `moved ${r.realizedMovePct}%` : "open";
    console.log(`  ${r.symbol.padEnd(6)} ${r.earningsDate.slice(0, 10)} ${r.verdict.padEnd(5)} ${r.structure.padEnd(28)} exp ${r.expiry}  ${tag}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
