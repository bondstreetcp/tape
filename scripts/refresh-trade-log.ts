/**
 * Builds data/trade-log.json — the TRACK RECORD for the Earnings-prep card's suggested plays.
 *
 * Two passes each night:
 *  1. LOG new plays. For US names reporting within ~12 days, reproduce EXACTLY the structure the card
 *     would suggest (lib/earningsTrade.buildEarningsTrade — same rich/cheap read, same strikes, same
 *     leg premiums) and record it with its expiry + entry premiums. One rec per name per print.
 *  2. SETTLE at the POST-PRINT. Once a logged name has reported, record the realized 1-day move AND grade
 *     the play right there — the structure is repriced the morning after with the event vol removed
 *     (lib/tradeLog.settlePostPrint), because an earnings play is a bet on the print, not on where the
 *     stock drifts to weeks later. A secondary held-to-expiry P&L is still filled in once expiry passes,
 *     for reference — but the headline grade is the print.
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
import { buildEarningsTrade } from "../lib/earningsTrade";
import { netCredit, payoffBounds, settleLegs, settlePostPrint, type TradeLogData, type TradeRec } from "../lib/tradeLog";
import { eventResolved, classRoot, type CorpEventsData } from "../lib/corpEvents";

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

// The post-print reaction straight from the chart: prior close → the first COMPLETED session after
// the print. AMC prints (≥20:00 UTC ≈ after the 4pm ET close) react the NEXT day; BMO react same-day.
// Returns null while the reaction session is still trading, so a partial-day move is never frozen in.
// Returns the signed move AND the reaction-day close + date (the close is what we settle the play at).
async function reactionFromChart(sym: string, eT: number): Promise<{ move: number; close: number; day: string } | null> {
  await throttle();
  const ch: any = await yf.chart(sym, { period1: new Date(eT - 10 * DAY), period2: new Date(eT + 6 * DAY), interval: "1d" } as any, { validateResult: false }).catch(() => null);
  const q = (ch?.quotes || [])
    .filter((x: any) => x?.close != null)
    .map((x: any) => ({ day: new Date(x.date).toISOString().slice(0, 10), close: x.close as number }));
  if (q.length < 2) return null;
  const eDay = new Date(eT).toISOString().slice(0, 10);
  const amc = new Date(eT).getUTCHours() >= 20;
  const idx = q.findIndex((b: { day: string }) => (amc ? b.day > eDay : b.day >= eDay));
  if (idx <= 0) return null; // no prior close, or the reaction session hasn't printed yet
  if (Date.now() < Date.parse(q[idx].day + "T21:30:00Z")) return null; // session not complete (~4:30pm ET buffer)
  return { move: q[idx].close / q[idx - 1].close - 1, close: q[idx].close, day: q[idx].day };
}

function outcomeOf(pnl: number, entry: number): TradeRec["outcome"] {
  const eps = Math.max(0.03, 0.03 * Math.abs(entry)); // ~3c/share (or 3% of the ticket) counts as a scratch
  return pnl > eps ? "win" : pnl < -eps ? "loss" : "scratch";
}

// A rec still needs work if it isn't settled yet, OR it's settled (at the post-print) but its
// secondary held-to-expiry mark hasn't been filled and its expiry has now passed.
const DAY_MS = 86_400_000;
function rec_needsExpiry(r: TradeRec): boolean {
  const expT = Date.parse(r.expiry + "T00:00:00Z");
  return r.pnlToExpiry == null && Number.isFinite(expT) && Date.now() >= expT + DAY_MS && r.legs.length > 0;
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

  // ── catalyst overlay: names with a LIVE disclosed strategic-alt / spin-off event ──
  // "Where it hits landmines": when a known catalyst (a strategic-alternatives update, a spin in
  // motion) is WHY vol is elevated into the print, the rich→sell read is selling event risk, not vol
  // mispricing. Stamp the flag on new recs at LOG time (annotation only — the play still logs and
  // grades, so the record can measure whether flagged sell-vol plays underperform). Best-effort: a
  // missing corp-events.json (fresh checkout) just means no flags attach this run.
  const CATALYST_KINDS = new Set<string>(["strategic-alt", "spin-off"]);
  const CATALYST_WINDOW_D = 120; // strategic reviews run months; older than this is likely resolved/stale
  const catalystByTicker = new Map<string, NonNullable<TradeRec["catalystFlag"]>>();
  try {
    const ce = JSON.parse(await fsp.readFile(path.join(DATA, "corp-events.json"), "utf8")) as CorpEventsData;
    for (const ev of ce.events || []) {
      if (!ev.ticker || !CATALYST_KINDS.has(ev.type)) continue;
      const t = Date.parse(ev.date);
      if (!Number.isFinite(t) || now - t > CATALYST_WINDOW_D * DAY) continue;
      const key = ev.ticker.toUpperCase();
      const prev = catalystByTicker.get(key);
      if (!prev || t > Date.parse(prev.date)) {
        catalystByTicker.set(key, { kind: ev.type as "strategic-alt" | "spin-off", headline: ev.headline, date: ev.date.slice(0, 10) });
      }
    }
  } catch { /* board missing on this box — no flags this run */ }
  // Drop tickers whose MOST RECENT event reads RESOLVED (completed spin / concluded review / signed
  // definitive deal) — the catalyst is over, so the elevated-IV caution no longer applies. Filtering
  // AFTER most-recent selection matters: an older "announced" event must not resurrect a ticker whose
  // spin has since completed (the MIDD case — "on track for completion" then "completed").
  for (const [k, v] of catalystByTicker) if (eventResolved(v.headline)) catalystByTicker.delete(k);
  // Alias each surviving flag under its share-class ROOT: EDGAR stores the FIRST-listed class (BF-A)
  // while snapshots trade the other (BF-B) — without the root fallback a Brown-Forman/Berkshire event
  // would silently never flag. Exact key wins at lookup; roots are the fallback.
  for (const [k, v] of [...catalystByTicker]) {
    const root = classRoot(k);
    if (root !== k) {
      const prev = catalystByTicker.get(root);
      if (!prev || Date.parse(v.date) > Date.parse(prev.date)) catalystByTicker.set(root, v);
    }
  }
  const flagFor = (sym: string) => catalystByTicker.get(sym.toUpperCase()) ?? catalystByTicker.get(classRoot(sym));
  if (catalystByTicker.size) console.log(`catalyst overlay: ${catalystByTicker.size} ticker keys with a LIVE strategic-alt/spin-off disclosure (≤${CATALYST_WINDOW_D}d, resolved filtered, class roots aliased)`);

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
      if (e <= now) continue; // print already happened — never log a play after the event
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
    // FULL timestamp, not date-only — straddleMove needs the hour to apply the AMC bracketing rule
    // (an after-close print must use an expiry strictly after the report date).
    const eIso = new Date(s._e).toISOString();
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
      expiry: built.trade.expiry || eIso.slice(0, 10),
      dte: built.trade.dte ?? Math.round((Date.parse((built.trade.expiry || eIso) + "T00:00:00Z") - now) / DAY),
      spotAtRec: +built.spot.toFixed(2),
      impliedMovePct: +built.impliedMovePct.toFixed(2),
      avgRealizedPct: +built.avgRealizedPct.toFixed(2),
      richnessRatio: +built.richnessRatio.toFixed(2),
      legs: legs.map((l) => ({ ...l, premium: +l.premium.toFixed(2) })),
      entryCredit: +entry.toFixed(2),
      maxProfit: maxProfit != null ? +maxProfit.toFixed(2) : null,
      maxLoss: maxLoss != null ? +maxLoss.toFixed(2) : null,
      // undefined (no live catalyst) is dropped by JSON.stringify — the field only appears when flagged
      catalystFlag: flagFor(s.symbol),
      status: "awaiting_print",
    };
    byId.set(rec.id, rec);
    logged++;
  });
  console.log(`logged ${logged} new plays`);

  // ── 1b. RE-STAMP the catalyst flag on already-logged recs ──
  // Flags used to be entry-time-only, which systematically missed the FRESHEST disclosures: corp-events
  // refreshes elsewhere in the nightly run, and an 8-K landing between logging and the print never got
  // a second look. Re-check nightly: ADD (never clear) a flag whenever the disclosure DATE precedes the
  // rec's print — provably pre-print regardless of when we notice it, so the annotation stays honest
  // even when stamped onto an already-settled rec.
  let restamped = 0;
  for (const rec of byId.values()) {
    if (rec.catalystFlag) continue;
    const flag = flagFor(rec.symbol);
    if (flag && Date.parse(flag.date) < Date.parse(rec.earningsDate)) { rec.catalystFlag = flag; restamped++; }
  }
  if (restamped) console.log(`catalyst overlay: re-stamped ${restamped} previously-logged recs (disclosure predates their print)`);

  // ── 2. SETTLE at the POST-PRINT (primary), then fill held-to-expiry (secondary) ──
  const openRecs = [...byId.values()].filter((r) => r.status !== "settled" || rec_needsExpiry(r));
  let settled = 0, expiryFilled = 0;
  await mapPool(openRecs, 5, async (rec) => {
    const eT = Date.parse(rec.earningsDate);
    const expT = Date.parse(rec.expiry + "T00:00:00Z");

    // (a) print has happened → get the reaction (move + reaction-day close) and GRADE the play there.
    // The chart is the source of truth: close before the print vs the first COMPLETED session after it.
    if (rec.status !== "settled" && Number.isFinite(eT) && now >= eT) {
      const rx = await reactionFromChart(rec.symbol, eT);
      if (rx != null) {
        rec.realizedMovePct = +(rx.move * 100).toFixed(2);
        rec.moveCleared = Math.abs(rec.realizedMovePct) > rec.impliedMovePct;
        rec.spotAtEarnings = +rx.close.toFixed(2);
        // Reprice the structure the morning after — the honest earnings-play grade.
        const daysToExp = Math.round((expT - Date.parse(rx.day + "T00:00:00Z")) / DAY);
        const pnl = settlePostPrint(rec, rx.close, daysToExp);
        if (pnl != null) {
          rec.pnl = +pnl.toFixed(2);
          rec.outcome = outcomeOf(pnl, rec.entryCredit);
          rec.settleBasis = "post-print";
          rec.settledAt = nowISO;
          rec.status = "settled";
          settled++;
        }
      }
    }

    // (b) once expiry passes, ALSO record what it would have been held to expiry — informational only,
    // never overrides the post-print grade.
    if (rec.pnlToExpiry == null && Number.isFinite(expT) && now >= expT + DAY && rec.legs.length) {
      const close = await closeOn(rec.symbol, rec.expiry);
      if (close != null) {
        rec.spotAtExpiry = +close.toFixed(2);
        rec.pnlToExpiry = +settleLegs(rec.legs, close).toFixed(2);
        // Older recs that were only ever graded at expiry keep that as their basis + primary pnl.
        if (rec.status !== "settled") {
          rec.pnl = rec.pnlToExpiry;
          rec.outcome = outcomeOf(rec.pnlToExpiry, rec.entryCredit);
          rec.settleBasis = "expiry";
          rec.settledAt = nowISO;
          rec.status = "settled";
        }
        expiryFilled++;
      }
    }
  });
  console.log(`settled ${settled} at the post-print, filled ${expiryFilled} held-to-expiry marks`);

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
