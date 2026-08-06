/**
 * Regime replay — grading the earnings-prep card's rules through real vol regimes (2020 / 2022 /
 * Aug-2024), trickled nightly against free data. The live track record spans five calm weeks; this
 * answers what the SAME rules did in the weather.
 *
 * Pipeline per run (all budgeted, all cached, resumable any night):
 *  1. EVENTS — S&P 500 names' historical earnings dates from EDGAR company submissions: an 8-K with
 *     item 2.02 IS the earnings release, dated. Cached per symbol. (Survivorship caveat, documented:
 *     the roster is TODAY'S constituents — fine for "do the rules survive a regime", not for an
 *     absolute-return claim.)
 *  2. CLOSES — one full-range Yahoo daily chart per symbol (2019→now), cached; every reaction move
 *     and every name's prior-reactions history computes locally from it.
 *  3. CHAINS — DoltHub `post-no-preference/options` public SQL API, ~2 queries per event: the last
 *     snapshot ≤ print-eve (within 6d), then that snapshot's chain at the nearest expiry past the
 *     reaction. EVENTS_PER_NIGHT (default 150) keeps the trickle polite; rejects are remembered.
 *  4. CONSTRUCT + SETTLE, production-parity: parity-ATM straddle → implied move; richness vs the
 *     name's own prior |reactions| (the card's 1.2 / 0.85 thresholds); rich → short strangle at the
 *     breakevens, cheap → long ATM straddle, fair → skip. Settled BOTH ways: settlePostPrint (the
 *     live book's BS event-var-strip grade) and intrinsic-at-reaction (the conservative floor).
 *     Crossed entry (shorts at bid / longs at ask) recorded — the chains carry bid/ask.
 *  Known honest limits: no historical skew → strangles-only on the sell side (the undefined-risk
 *  variant, where the live tail lives — conservative); day-gapped snapshots mean some entries price
 *  1-3 days before the eve (understates event premium → conservative for sells); small caps absent.
 *
 * Output: data/regime-replay.json (forward-accumulating log + per-window aggregates printed each
 * run). Deliberately NOT in dataFreshness — a research artifact accumulating toward completion, not
 * a user-facing feed; the board/report comes when the windows fill.
 *
 *   npm run refresh-regime-replay          (nightly FULL step)
 *   EVENTS_PER_NIGHT=10 npx tsx …          (smoke run)
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { getSubmissions, tickerToCik } from "../lib/edgar";
import { deadline, withDeadline } from "../lib/deadline";
import { settleLegs, settlePostPrint, type TradeLeg, type TradeRec } from "../lib/tradeLog";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const OUT = path.join(DATA, "regime-replay.json");
const CACHE = path.join(DATA, ".tmp", "replay-cache.json");
const BUDGET = Number(process.env.EVENTS_PER_NIGHT) || 150;
const DAY = 86_400_000;

const WINDOWS: { id: string; from: string; to: string }[] = [
  { id: "covid-2020", from: "2020-02-01", to: "2020-04-30" },
  { id: "bear-2022", from: "2022-01-01", to: "2022-10-31" },
  { id: "vix-aug-2024", from: "2024-07-01", to: "2024-08-31" },
];

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

interface ReplayRow {
  id: string; // `${symbol}-${eventDay}`
  window: string;
  symbol: string;
  eventDay: string; // 8-K item-2.02 filing day (calendar square)
  entryDate: string; // DoltHub snapshot the structure was priced on
  expiry: string;
  verdict: "rich" | "cheap";
  structure: string;
  spot: number;
  impliedPct: number;
  avgRealizedPct: number;
  histN: number;
  richness: number;
  legs: TradeLeg[];
  entryCredit: number;
  entryCreditCrossed: number | null;
  reactionDay: string;
  realizedPct: number;
  pnlPostPrint: number | null; // per share, the live book's grading method
  pnlIntrinsic: number; // per share, conservative floor
}
interface ReplayFile { generatedAt: string; rows: ReplayRow[]; graded: number; rejected: number; pendingEstimate: number }
interface CacheFile {
  events: Record<string, string[]>; // symbol → 8-K 2.02 filing days (all, sorted)
  closes: Record<string, [string, number][]>; // symbol → [day, close] 2019→now
  rejects: Record<string, string>; // eventId → reason (never retried)
}

async function dolt(sql: string): Promise<any[]> {
  const res = await fetch(`https://www.dolthub.com/api/v1alpha1/post-no-preference/options/master?q=${encodeURIComponent(sql)}`, { signal: deadline(45_000) });
  if (!res.ok) throw new Error(`dolthub ${res.status}`);
  return ((await res.json()) as any).rows ?? [];
}

/** All 8-K item-2.02 filing days for a symbol, walking older submission pages when the window needs them. */
async function earningsDays(symbol: string): Promise<string[]> {
  const cik = await tickerToCik(symbol);
  if (!cik) return [];
  const sub: any = await getSubmissions(cik);
  const days = new Set<string>();
  const scan = (block: any) => {
    const forms: string[] = block?.form ?? [];
    const items: string[] = block?.items ?? [];
    const dates: string[] = block?.filingDate ?? [];
    for (let i = 0; i < forms.length; i++)
      if (forms[i]?.startsWith("8-K") && /(^|,)\s*2\.02/.test(items[i] ?? "")) days.add(dates[i]);
  };
  scan(sub?.filings?.recent);
  const oldest = (sub?.filings?.recent?.filingDate ?? []).slice(-1)[0];
  if (oldest && oldest > "2019-06-01") {
    for (const f of sub?.filings?.files ?? []) {
      const extra: any = await fetch(`https://data.sec.gov/submissions/${f.name}`, { headers: { "User-Agent": "stock-chart-screener (research; jameslyeh@gmail.com)" }, signal: deadline(20_000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
      if (extra) scan(extra);
      await sleep(150);
    }
  }
  return [...days].sort();
}

async function fullCloses(symbol: string): Promise<[string, number][]> {
  const ch: any = await withDeadline(
    yf.chart(symbol, { period1: new Date("2019-01-01"), period2: new Date(), interval: "1d" } as any, { validateResult: false }),
    25_000,
    `chart ${symbol}`,
  ).catch(() => null);
  return ((ch?.quotes ?? []) as any[])
    .filter((q) => q?.close != null)
    .map((q) => [new Date(q.date).toISOString().slice(0, 10), q.close as number]);
}

function reactionOf(closes: [string, number][], eventDay: string): { day: string; pct: number; close: number; evClose: number } | null {
  // The 8-K files the day of (AMC) or the morning after (BMO) the release — the true reaction day is
  // whichever of [eventDay, next session] moved more. Self-correcting and convention-free.
  const idx = closes.findIndex(([d]) => d >= eventDay);
  if (idx < 1 || idx + 1 >= closes.length) return null;
  const cand = [idx, idx + 1]
    .filter((i) => i < closes.length)
    .map((i) => ({ day: closes[i][0], pct: closes[i][1] / closes[i - 1][1] - 1, close: closes[i][1], evClose: closes[i - 1][1] }));
  cand.sort((a, b) => Math.abs(b.pct) - Math.abs(a.pct));
  return cand[0] ?? null;
}

async function main() {
  const roster: string[] = JSON.parse(await fsp.readFile(path.join(DATA, "constituents", "sp500.json"), "utf8")).map((e: any) => e.symbol);
  let cache: CacheFile = { events: {}, closes: {}, rejects: {} };
  try { cache = { ...cache, ...JSON.parse(await fsp.readFile(CACHE, "utf8")) }; } catch { /* first run */ }
  let out: ReplayFile = { generatedAt: "", rows: [], graded: 0, rejected: 0, pendingEstimate: 0 };
  try { out = JSON.parse(await fsp.readFile(OUT, "utf8")); } catch { /* first run */ }
  const done = new Set(out.rows.map((r) => r.id));

  let fetches = 0;
  let graded = 0;
  outer: for (const symbol of roster) {
    if (fetches >= BUDGET) break;
    // 1. events (EDGAR, cached once per symbol)
    if (!cache.events[symbol]) {
      cache.events[symbol] = await earningsDays(symbol).catch(() => []);
      await sleep(150);
      fetches++;
    }
    const events = cache.events[symbol].filter((d) => WINDOWS.some((w) => d >= w.from && d <= w.to));
    if (!events.length) continue;
    const todo = events.filter((d) => !done.has(`${symbol}-${d}`) && !cache.rejects[`${symbol}-${d}`]);
    if (!todo.length) continue;
    // 2. closes (one chart per symbol, cached)
    if (!cache.closes[symbol]) {
      cache.closes[symbol] = await fullCloses(symbol);
      fetches++;
    }
    const closes = cache.closes[symbol];
    if (closes.length < 300) { for (const d of todo) cache.rejects[`${symbol}-${d}`] = "no-price-history"; continue; }

    for (const eventDay of todo) {
      if (fetches >= BUDGET) break outer;
      const id = `${symbol}-${eventDay}`;
      const rx = reactionOf(closes, eventDay);
      if (!rx) { cache.rejects[id] = "no-reaction"; continue; }
      // Prior |reactions| for the richness read — the card uses up to 8.
      const prior = cache.events[symbol].filter((d) => d < eventDay).slice(-8);
      const hist = prior.map((d) => reactionOf(closes, d)).filter((x): x is NonNullable<typeof x> => !!x).map((x) => Math.abs(x.pct) * 100);
      if (hist.length < 3) { cache.rejects[id] = "thin-history"; continue; }
      const avgRealizedPct = hist.reduce((a, b) => a + b, 0) / hist.length;

      // 3. entry chain: walk BACK from print-eve one day at a time with cheap single-date probes —
      // a BETWEEN + DISTINCT over the range scans and times the public API out (measured, 45s);
      // per-(symbol,date) lookups return in ~1-2s. Stop at the first snapshot carrying an expiry
      // past the reaction day (rotating expiry subsets mean a snapshot can exist yet have none).
      let entryDate: string | null = null;
      let expiry: string | null = null;
      for (let back = 1; back <= 6 && fetches < BUDGET; back++) {
        const d = new Date(Date.parse(eventDay) - back * DAY).toISOString().slice(0, 10);
        let exps: any[] = [];
        try { exps = await dolt(`SELECT DISTINCT expiration FROM option_chain WHERE act_symbol='${symbol}' AND date='${d}'`); fetches++; }
        catch (e: any) { console.warn(`  dolthub unhappy at ${id} (${String(e?.message || e).slice(0, 80)}) — stopping the night politely, resume tomorrow`); break outer; }
        await sleep(400);
        const ok = exps.map((x) => x.expiration).filter((x: string) => x > rx.day).sort();
        if (ok.length) { entryDate = d; expiry = ok[0]; break; }
      }
      if (!entryDate || !expiry) { cache.rejects[id] = "no-chain"; continue; }
      let chain: any[] = [];
      try { chain = await dolt(`SELECT strike, call_put, bid, ask FROM option_chain WHERE act_symbol='${symbol}' AND date='${entryDate}' AND expiration='${expiry}'`); fetches++; }
      catch (e: any) { console.warn(`  dolthub unhappy at ${id} chain (${String(e?.message || e).slice(0, 80)}) — stopping the night`); break outer; }
      await sleep(500);

      // 4. construct + settle (production parity).
      const by: Record<number, { Call?: any; Put?: any }> = {};
      for (const o of chain) {
        const b = +o.bid, a = +o.ask;
        if (!(b > 0) || !(a > 0)) continue; // one-sided quotes can't price entries OR crossed fills
        (by[+o.strike] ??= {})[o.call_put as "Call" | "Put"] = { bid: b, ask: a, mid: (a + b) / 2 };
      }
      const strikes = Object.keys(by).map(Number).filter((k) => by[k].Call && by[k].Put).sort((a, b) => a - b);
      if (strikes.length < 4) { cache.rejects[id] = "thin-chain"; continue; }
      const atm = strikes.reduce((a, k) => (Math.abs(by[k].Call!.mid - by[k].Put!.mid) < Math.abs(by[a].Call!.mid - by[a].Put!.mid) ? k : a));
      const spot = atm + by[atm].Call!.mid - by[atm].Put!.mid;
      const straddle = by[atm].Call!.mid + by[atm].Put!.mid;
      if (!(spot > 0) || !(straddle > 0)) { cache.rejects[id] = "bad-parity"; continue; }
      const impliedPct = (straddle / spot) * 100;
      const richness = impliedPct / avgRealizedPct;
      const verdict = richness >= 1.2 ? "rich" : richness <= 0.85 ? "cheap" : null;
      if (!verdict) { cache.rejects[id] = "fair"; continue; }

      const all = Object.keys(by).map(Number).sort((a, b) => a - b);
      const near = (t: number, type: "Call" | "Put") => {
        const c = all.filter((k) => by[k][type]);
        return c.reduce((a, k) => (Math.abs(k - t) < Math.abs(a - t) ? k : a));
      };
      let legs: TradeLeg[];
      let structure: string;
      if (verdict === "rich") {
        const pK = near(spot - straddle, "Put"), cK = near(spot + straddle, "Call");
        legs = [
          { type: "P", side: "short", strike: pK, premium: by[pK].Put!.mid, bid: by[pK].Put!.bid, ask: by[pK].Put!.ask },
          { type: "C", side: "short", strike: cK, premium: by[cK].Call!.mid, bid: by[cK].Call!.bid, ask: by[cK].Call!.ask },
        ];
        structure = "Short strangle";
      } else {
        legs = [
          { type: "C", side: "long", strike: atm, premium: by[atm].Call!.mid, bid: by[atm].Call!.bid, ask: by[atm].Call!.ask },
          { type: "P", side: "long", strike: atm, premium: by[atm].Put!.mid, bid: by[atm].Put!.bid, ask: by[atm].Put!.ask },
        ];
        structure = "Long straddle";
      }
      const entryCredit = legs.reduce((s, l) => s + (l.side === "short" ? l.premium : -l.premium), 0);
      const crossed = legs.every((l) => l.bid && l.ask) ? +legs.reduce((s, l) => s + (l.side === "short" ? l.bid! : -l.ask!), 0).toFixed(2) : null;
      const dte = Math.max(1, Math.round((Date.parse(expiry) - Date.parse(entryDate)) / DAY));
      const rec = {
        legs, dte, entryCredit, impliedMovePct: impliedPct, spotAtRec: spot,
      } as unknown as TradeRec;
      // ⚠ SETTLE IN THE CHAIN'S DOLLARS. The chart closes are SPLIT-ADJUSTED; historical strikes are
      // not (AAPL 2020: strikes ~$270-305, adjusted close ~$73 — settling one against the other read a
      // +2.1% print as a -$191/share disaster on the first smoke run). The reaction RATIO is
      // split-invariant, so the settle spot is the parity-derived chain spot moved by that ratio.
      const rxCloseChain = spot * (1 + rx.pct);
      const daysAfter = Math.max(0, Math.round((Date.parse(expiry) - Date.parse(rx.day)) / DAY));
      const pnlPP = settlePostPrint(rec, rxCloseChain, daysAfter);
      out.rows.push({
        id, window: WINDOWS.find((w) => eventDay >= w.from && eventDay <= w.to)!.id, symbol, eventDay,
        entryDate, expiry, verdict, structure, spot: +spot.toFixed(2), impliedPct: +impliedPct.toFixed(2),
        avgRealizedPct: +avgRealizedPct.toFixed(2), histN: hist.length, richness: +richness.toFixed(2),
        legs: legs.map((l) => ({ ...l, premium: +l.premium.toFixed(2) })),
        entryCredit: +entryCredit.toFixed(2), entryCreditCrossed: crossed,
        reactionDay: rx.day, realizedPct: +(rx.pct * 100).toFixed(2),
        pnlPostPrint: pnlPP != null ? +pnlPP.toFixed(2) : null,
        pnlIntrinsic: +settleLegs(legs, rxCloseChain).toFixed(2),
      });
      done.add(id);
      graded++;
    }
  }

  out.generatedAt = new Date().toISOString();
  out.graded = out.rows.length;
  out.rejected = Object.keys(cache.rejects).length;
  const withEvents = Object.values(cache.events).flat().filter((d) => WINDOWS.some((w) => d >= w.from && d <= w.to)).length;
  out.pendingEstimate = Math.max(0, withEvents - out.graded - out.rejected);
  await fsp.mkdir(path.join(DATA, ".tmp"), { recursive: true });
  await fsp.writeFile(CACHE, JSON.stringify(cache));
  await fsp.writeFile(OUT, JSON.stringify(out));

  console.log(`regime-replay: +${graded} graded tonight (${fetches} fetches) · total ${out.graded} graded, ${out.rejected} rejected, ~${out.pendingEstimate} pending`);
  for (const w of WINDOWS) {
    const rows = out.rows.filter((r) => r.window === w.id);
    if (!rows.length) continue;
    const sells = rows.filter((r) => r.verdict === "rich");
    const per100k = (r: ReplayRow, pnl: number) => (pnl * 100000) / r.spot;
    const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
    const s$ = sum(sells.map((r) => per100k(r, r.pnlPostPrint ?? r.pnlIntrinsic)));
    console.log(`  ${w.id.padEnd(14)} ${rows.length} graded (${sells.length} sells): sell-side ${Math.round(s$).toLocaleString()} per-100k total · worst ${Math.round(Math.min(0, ...sells.map((r) => per100k(r, r.pnlPostPrint ?? r.pnlIntrinsic)))).toLocaleString()}`);
  }
}

main().catch((e) => { console.error("refresh-regime-replay:", String(e?.message || e)); process.exit(1); });
