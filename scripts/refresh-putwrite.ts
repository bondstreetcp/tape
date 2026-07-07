/**
 * Builds data/putwrite.json — the cash-secured put-writing screen.
 *
 * 1. Screen the US universes (union of Russell 3000 / S&P 1500 / Nasdaq 100 / …) for names a
 *    put-writer would be happy to own if assigned: established names (> $1B), ROE > 15%, 0 < P/E < 25.
 * 2. For each, pull the option chain at the expiry nearest 35 DTE (25-50 window), back the ATM
 *    implied vol out of the premium (Yahoo's iv field is unreliable), locate the ~16-delta put,
 *    and compute its premium, annualized yield, downside cushion and breakeven.
 * 3. Tag each with a realized-vol rank (the elevated-vol proxy until stored IV history catches
 *    up) and accrue today's ATM IV into data/putwrite-ivhist.json so a true IV-Rank comes online.
 *
 * Premiums are end-of-day last (or bid/ask mid when the options market is open) — indicative,
 * not a live fill. Run: npm run refresh-putwrite. Wired into the nightly FULL refresh.
 */
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot, loadSymbolSeries } from "../lib/data";
import { getOptions } from "../lib/options";
import {
  ivFromPut, putDelta, ivFromCall, callDelta, realizedVol, realizedVolRank, ivPercentile, PUT_TENORS, Z_16DELTA,
  type TenorId, type PutWriteCandidate, type PutWriteData, type PutSuggestion, type CallSuggestion,
  type BullPutSuggestion, type IronCondorSuggestion,
} from "../lib/putwrite";

const DATA = path.join(process.cwd(), "data");
const US_UNIVERSES = ["russell3000", "sp1500", "russell1000", "nasdaq100", "sp500"];
const MIN_MKTCAP = 0.5e9;
const MIN_ROE = 0.15;
const MAX_PE = 25;
const R = 0.043; // risk-free approx (~3M T-bill); only affects delta/IV at the margin
// Expiry windows + the target delta per tenor live in PUT_TENORS (lib/putwrite). Each prefers a
// tight band but falls back to the nearest listed expiry in a wider one — monthly-only names (no
// weeklies) have gaps, so a narrow window would silently drop them.
const IVHIST = path.join(DATA, "putwrite-ivhist.json");
const IVHIST_CAP = 300;

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

// GLOBAL rate limiter. Yahoo throttles bursts of option-chain calls regardless of per-name
// retries, so serialize the START of every call ≥350ms apart across all workers. Concurrency
// then only overlaps the network latency, not the request rate.
let gate: Promise<void> = Promise.resolve();
function throttle(gap = 350): Promise<void> {
  const p = gate.then(() => sleep(gap));
  gate = p;
  return p;
}

async function chainRetry(sym: string, date?: string) {
  for (let i = 0; i < 4; i++) {
    await throttle();
    try { const c = await getOptions(sym, date); if (c.puts.length || (!date && c.expirations.length)) return c; } catch { /* retry */ }
    await sleep(500 + i * 400);
  }
  await throttle();
  return getOptions(sym, date);
}

// Pick the listed option whose strike is nearest the z-quantile target (z>0 ⇒ below spot for put
// wings, z<0 ⇒ above spot for call wings). Used to locate the credit-spread short/long wings.
function pickByZ(opts: any[], spot: number, T: number, iv: number, z: number, R: number): any | null {
  if (!opts.length) return null;
  const k = spot * Math.exp((R + (iv * iv) / 2) * T - z * iv * Math.sqrt(T));
  return opts.reduce((a, b) => (Math.abs(b.strike - k) < Math.abs(a.strike - k) ? b : a));
}

// For one tenor: pick the expiry (prefer the tight band, else nearest in the wide window), back
// ATM IV out of the premium, then locate BOTH legs from the same chain — the put at the tenor's
// target delta (via z) and the covered call at its target delta (via zCall) — and sanity-check each.
// Returns the put, the covered call (same expiry), and the ATM IV (the per-name vol signal).
async function buildLegsAtTenor(
  sym: string, base: any, spot: number, tenor: (typeof PUT_TENORS)[number],
): Promise<{ put: PutSuggestion | null; call: CallSuggestion | null; bullPut: BullPutSuggestion | null; condor: IronCondorSuggestion | null; atmIV: number | null }> {
  const now = Date.now();
  const allExp = base.expirations
    .map((d: string) => ({ d, dte: Math.round((Date.parse(d + "T00:00:00Z") - now) / 86_400_000) }))
    .filter((e: { dte: number }) => e.dte >= tenor.dteMin && e.dte <= tenor.dteMax);
  const pref = allExp.filter((e: { dte: number }) => e.dte >= tenor.prefMin && e.dte <= tenor.prefMax);
  const exp = (pref.length ? pref : allExp).sort(
    (a: { dte: number }, b: { dte: number }) => Math.abs(a.dte - tenor.targetDte) - Math.abs(b.dte - tenor.targetDte),
  )[0];
  if (!exp) return { put: null, call: null, bullPut: null, condor: null, atmIV: null };
  const chain = exp.d === base.selected ? base : await chainRetry(sym, exp.d);
  const T = exp.dte / 365;
  const midOf = (o: any): number | null => (o.bid && o.ask ? (o.bid + o.ask) / 2 : o.last);
  const puts = chain.puts.map((p: any) => ({ ...p, m: midOf(p) })).filter((p: any) => p.strike < spot && p.m && p.m > 0);
  if (!puts.length) return { put: null, call: null, bullPut: null, condor: null, atmIV: null };
  const atm = puts.reduce((a: any, b: any) => (Math.abs(b.strike - spot) < Math.abs(a.strike - spot) ? b : a));
  const ai = ivFromPut(spot, atm.strike, T, R, atm.m);
  const atmIV = ai && ai > 0.05 && ai < 2 ? ai : null;
  const kTarget = atmIV
    ? spot * Math.exp((R + (atmIV * atmIV) / 2) * T - tenor.z * atmIV * Math.sqrt(T))
    : spot * (1 - 0.1 * Math.sqrt(tenor.targetDte / 35)); // crude fallback, scaled by √time
  const pick = puts.reduce((a: any, b: any) => (Math.abs(b.strike - kTarget) < Math.abs(a.strike - kTarget) ? b : a));
  const iv = ivFromPut(spot, pick.strike, T, R, pick.m);
  const delta = iv ? putDelta(spot, pick.strike, T, R, iv) : null;
  const yieldPct = (pick.m / pick.strike) * 100;
  let put: PutSuggestion | null = {
    expiry: exp.d, dte: exp.dte, strike: pick.strike,
    delta: delta != null ? +delta.toFixed(2) : 0,
    iv: iv != null ? +iv.toFixed(3) : atmIV ?? 0,
    premium: +pick.m.toFixed(2), premiumSrc: pick.bid && pick.ask ? "mid" : "last",
    yieldPct: +yieldPct.toFixed(2), annPct: +((yieldPct * 365) / exp.dte).toFixed(1),
    cushionPct: +(((spot - pick.strike) / spot) * 100).toFixed(1),
    breakeven: +(pick.strike - pick.m).toFixed(2),
  };
  // Reject stale/illiquid prints: a real cash-secured put doesn't yield 75%+ annualized (stale
  // last trade on a thin option), and the strike should be a sane distance OTM. Same guard for
  // both tenors — the longer-dated/lower-delta put just naturally sits well inside these bounds.
  if (put.iv < 0.05 || put.iv > 1.5 || Math.abs(put.delta) < 0.02 || Math.abs(put.delta) > 0.45 || put.cushionPct < 2.5 || put.annPct > 65) {
    put = null;
  }

  // Covered call from the SAME chain/expiry (zero extra fetch): the ~callDelta OTM call.
  let call: CallSuggestion | null = null;
  const calls = chain.calls.map((o: any) => ({ ...o, m: midOf(o) })).filter((o: any) => o.strike > spot && o.m && o.m > 0);
  if (calls.length) {
    const kCall = atmIV
      ? spot * Math.exp((R + (atmIV * atmIV) / 2) * T - tenor.zCall * atmIV * Math.sqrt(T))
      : spot * (1 + 0.1 * Math.sqrt(tenor.targetDte / 35)); // crude OTM fallback, scaled by √time
    const cpick = calls.reduce((a: any, b: any) => (Math.abs(b.strike - kCall) < Math.abs(a.strike - kCall) ? b : a));
    const civ = ivFromCall(spot, cpick.strike, T, R, cpick.m);
    const cdelta = civ ? callDelta(spot, cpick.strike, T, R, civ) : null;
    const cyield = (cpick.m / spot) * 100; // premium as a % of the shares you hold
    const ifCalled = ((cpick.m + (cpick.strike - spot)) / spot) * 100; // premium + capital gain to the strike
    call = {
      expiry: exp.d, dte: exp.dte, strike: cpick.strike,
      delta: cdelta != null ? +cdelta.toFixed(2) : 0,
      iv: civ != null ? +civ.toFixed(3) : atmIV ?? 0,
      premium: +cpick.m.toFixed(2), premiumSrc: cpick.bid && cpick.ask ? "mid" : "last",
      yieldPct: +cyield.toFixed(2), annPct: +((cyield * 365) / exp.dte).toFixed(1),
      ifCalledPct: +ifCalled.toFixed(2), ifCalledAnnPct: +((ifCalled * 365) / exp.dte).toFixed(1),
      capPct: +(((cpick.strike - spot) / spot) * 100).toFixed(1),
      breakeven: +(spot - cpick.m).toFixed(2),
    };
    // Same liquidity/sanity guard as the put: drop stale/illiquid prints (absurd yields, near-ATM caps).
    if (call.iv < 0.05 || call.iv > 1.5 || call.delta < 0.05 || call.delta > 0.55 || call.capPct < 1 || call.annPct > 80) {
      call = null;
    }
  }

  // Defined-risk credit spreads from the same chain: 16Δ short / ~8Δ long wings.
  let bullPut: BullPutSuggestion | null = null;
  let condor: IronCondorSuggestion | null = null;
  if (atmIV && puts.length >= 2) {
    const sp = pickByZ(puts, spot, T, atmIV, Z_16DELTA, R); // ~16Δ short put
    const lp = pickByZ(puts, spot, T, atmIV, 1.4051, R); // ~8Δ long put (the risk-defining wing)
    if (sp && lp && sp.strike > lp.strike) {
      const credit = sp.m - lp.m, width = sp.strike - lp.strike, maxLoss = width - credit;
      const sd = ivFromPut(spot, sp.strike, T, R, sp.m);
      const pop = sd ? 1 - Math.abs(putDelta(spot, sp.strike, T, R, sd)) : 0.84;
      // guard: a credit >70% of the width or a sub-coin-flip short = stale prints / too-near-ATM
      if (credit > 0.02 && maxLoss > 0.02 && credit / width <= 0.7 && pop >= 0.5) {
        bullPut = {
          expiry: exp.d, dte: exp.dte, shortStrike: sp.strike, longStrike: lp.strike,
          credit: +credit.toFixed(2), width: +width.toFixed(2), maxLoss: +maxLoss.toFixed(2),
          ror: +(credit / maxLoss).toFixed(3), pop: +pop.toFixed(2), breakeven: +(sp.strike - credit).toFixed(2),
        };
      }
    }
    // iron condor = the bull-put spread + a mirror bear-call spread
    const sc = pickByZ(calls, spot, T, atmIV, -Z_16DELTA, R); // ~16Δ short call
    const lc = pickByZ(calls, spot, T, atmIV, -1.4051, R); // ~8Δ long call
    if (sp && lp && sc && lc && sp.strike > lp.strike && lc.strike > sc.strike && sc.strike > sp.strike) {
      const credit = sp.m - lp.m + (sc.m - lc.m);
      const width = Math.max(sp.strike - lp.strike, lc.strike - sc.strike), maxLoss = width - credit;
      const spd = ivFromPut(spot, sp.strike, T, R, sp.m), scd = ivFromCall(spot, sc.strike, T, R, sc.m);
      const pBelow = spd ? Math.abs(putDelta(spot, sp.strike, T, R, spd)) : 0.16;
      const pAbove = scd ? callDelta(spot, sc.strike, T, R, scd) : 0.16;
      const pop = Math.max(0, 1 - pBelow - pAbove);
      if (credit > 0.05 && maxLoss > 0.05 && credit / width <= 0.7 && pop >= 0.45) {
        condor = {
          expiry: exp.d, dte: exp.dte,
          putLong: lp.strike, putShort: sp.strike, callShort: sc.strike, callLong: lc.strike,
          credit: +credit.toFixed(2), width: +width.toFixed(2), maxLoss: +maxLoss.toFixed(2),
          ror: +(credit / maxLoss).toFixed(3), pop: +pop.toFixed(2),
          lowBE: +(sp.strike - credit).toFixed(2), highBE: +(sc.strike + credit).toFixed(2),
        };
      }
    }
  }

  return { put, call, bullPut, condor, atmIV };
}

async function main() {
  // 1. union the US universes into one de-duped candidate pool
  const seen = new Set<string>();
  const pool: any[] = [];
  for (const uni of US_UNIVERSES) {
    const snap = await loadSnapshot(uni);
    if (!snap) { console.log("  (no snapshot:", uni, ")"); continue; }
    for (const s of snap.stocks) if (!seen.has(s.symbol)) { seen.add(s.symbol); pool.push(s); }
  }
  // 2. fundamental filter — the "I'd own it" gate
  const screened = pool.filter(
    (s) => s.marketCap > MIN_MKTCAP && (s.fund?.roe ?? -1) > MIN_ROE && s.trailingPE != null && s.trailingPE > 0 && s.trailingPE < MAX_PE,
  );
  console.log(`pool ${pool.length} US names → ${screened.length} pass (mktcap>$${MIN_MKTCAP / 1e9}B, ROE>15%, 0<P/E<25)`);

  let ivhist: Record<string, [string, number][]> = {};
  try { ivhist = JSON.parse(await fsp.readFile(IVHIST, "utf8")); } catch { /* first run */ }
  const today = new Date().toISOString().slice(0, 10);

  const built = await mapPool(screened, 8, async (s) => {
    const sym: string = s.symbol;

    // realized vol + 1y rank from the stored daily series
    let rvol: number | null = null, rvolRank: number | null = null;
    const series = await loadSymbolSeries(sym);
    if (series?.daily?.length) {
      const closes = series.daily.map((d: any) => (Array.isArray(d) ? d[1] : d.c)).filter((c: number) => Number.isFinite(c) && c > 0);
      rvol = realizedVol(closes, 20);
      rvolRank = realizedVolRank(closes, 20, 252);
    }

    // options: from one chain pull, build the put at each tenor (~1M ≈16Δ and ~3M ≈10Δ)
    const puts: Record<TenorId, PutSuggestion | null> = { m1: null, m3: null };
    const calls: Record<TenorId, CallSuggestion | null> = { m1: null, m3: null };
    const bullPuts: Record<TenorId, BullPutSuggestion | null> = { m1: null, m3: null };
    const condors: Record<TenorId, IronCondorSuggestion | null> = { m1: null, m3: null };
    let atmIV: number | null = null, spot: number | null = null;
    try {
      const base = await chainRetry(sym);
      spot = base.underlying ?? s.price ?? null;
      if (spot && base.expirations.length) {
        const r1 = await buildLegsAtTenor(sym, base, spot, PUT_TENORS[0]); // ~1 month
        const r3 = await buildLegsAtTenor(sym, base, spot, PUT_TENORS[1]); // ~3 months
        puts.m1 = r1.put; calls.m1 = r1.call; bullPuts.m1 = r1.bullPut; condors.m1 = r1.condor;
        puts.m3 = r3.put; calls.m3 = r3.call; bullPuts.m3 = r3.bullPut; condors.m3 = r3.condor;
        atmIV = r1.atmIV ?? r3.atmIV; // single per-name vol signal (prefer the 1M ATM)
      }
    } catch { /* leave legs null */ }

    // accrue ATM IV history → IV percentile (null until ~30 days banked)
    let ivRank: number | null = null;
    if (atmIV != null) {
      const h = (ivhist[sym] ||= []);
      if (!h.length || h[h.length - 1][0] !== today) h.push([today, +atmIV.toFixed(4)]);
      if (h.length > IVHIST_CAP) h.splice(0, h.length - IVHIST_CAP);
      ivRank = ivPercentile(h.map((x) => x[1]), atmIV, 30);
    }

    const cand: PutWriteCandidate = {
      symbol: sym, name: s.name, sector: s.sector || "—", price: spot ?? s.price,
      marketCap: s.marketCap, roe: s.fund?.roe ?? null, pe: s.trailingPE ?? null,
      divYield: s.dividendYield ?? null,
      nextEarnings: s.earningsDate ?? null, earningsEstimate: !!s.earningsEstimate,
      rvol: rvol != null ? +rvol.toFixed(3) : null,
      rvolRank: rvolRank != null ? Math.round(rvolRank) : null,
      atmIV: atmIV != null ? +atmIV.toFixed(3) : null,
      ivRank: ivRank != null ? Math.round(ivRank) : null,
      ivPremium: atmIV != null && rvol != null && rvol > 0 ? +(atmIV / rvol).toFixed(2) : null,
      puts, calls, bullPuts, condors,
    };
    return cand;
  });

  const candidates = built
    .filter((c): c is PutWriteCandidate => !!c)
    .sort((a, b) => (b.puts.m1?.annPct ?? -1) - (a.puts.m1?.annPct ?? -1));

  const data: PutWriteData = {
    generatedAt: new Date().toISOString(),
    source: "US large/mid caps (Russell 3000 ∪ S&P 1500 ∪ Nasdaq 100)",
    rfRate: R,
    filters: { minMarketCap: MIN_MKTCAP, minRoe: MIN_ROE, maxPe: MAX_PE },
    candidates,
  };
  await fsp.writeFile(path.join(DATA, "putwrite.json"), JSON.stringify(data));
  await fsp.writeFile(IVHIST, JSON.stringify(ivhist));
  const withM1 = candidates.filter((c) => c.puts.m1).length;
  const withM3 = candidates.filter((c) => c.puts.m3).length;
  const withC1 = candidates.filter((c) => c.calls.m1).length;
  const withBP1 = candidates.filter((c) => c.bullPuts.m1).length;
  const withIC1 = candidates.filter((c) => c.condors.m1).length;
  console.log(`\nwrote ${candidates.length} candidates (${withM1} ~1M put, ${withM3} ~3M put, ${withC1} ~1M call, ${withBP1} ~1M bull-put, ${withIC1} ~1M condor).`);
  console.log("top by 1M annualized yield:");
  for (const c of candidates.slice(0, 8)) {
    const p1 = c.puts.m1, p3 = c.puts.m3;
    console.log(`  ${c.symbol.padEnd(6)} 1M ${p1 ? `$${p1.strike} ${p1.dte}d Δ${p1.delta} · ${p1.annPct}% ann · ${p1.cushionPct}% cush` : "—"}  |  3M ${p3 ? `$${p3.strike} ${p3.dte}d Δ${p3.delta} · ${p3.annPct}% ann · ${p3.cushionPct}% cush` : "—"}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
