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
  ivFromPut, putDelta, realizedVol, realizedVolRank, ivPercentile, Z_16DELTA,
  type PutWriteCandidate, type PutWriteData, type PutSuggestion,
} from "../lib/putwrite";

const DATA = path.join(process.cwd(), "data");
const US_UNIVERSES = ["russell3000", "sp1500", "russell1000", "nasdaq100", "sp500"];
const MIN_MKTCAP = 0.5e9;
const MIN_ROE = 0.15;
const MAX_PE = 25;
const R = 0.043; // risk-free approx (~3M T-bill); only affects delta/IV at the margin
// Prefer the user's 30-45 DTE band, but fall back to the nearest listed expiry in a wider
// window — monthly-only names (no weeklies) jump from ~23 to ~58 DTE, straddling 30-45, so a
// narrow window silently drops every such name. Widen to always catch a tradeable monthly.
const DTE_MIN = 18, DTE_MAX = 66, DTE_TARGET = 35;
const PREF_MIN = 30, PREF_MAX = 45;
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

    // options: chain nearest 35 DTE → ATM IV from premium → ~16-delta put
    let put: PutSuggestion | null = null, atmIV: number | null = null, spot: number | null = null;
    try {
      const base = await chainRetry(sym);
      spot = base.underlying ?? s.price ?? null;
      if (spot && base.expirations.length) {
        const now = Date.now();
        const allExp = base.expirations
          .map((d) => ({ d, dte: Math.round((Date.parse(d + "T00:00:00Z") - now) / 86_400_000) }))
          .filter((e) => e.dte >= DTE_MIN && e.dte <= DTE_MAX);
        const pref = allExp.filter((e) => e.dte >= PREF_MIN && e.dte <= PREF_MAX);
        const exp = (pref.length ? pref : allExp).sort((a, b) => Math.abs(a.dte - DTE_TARGET) - Math.abs(b.dte - DTE_TARGET))[0];
        if (exp) {
          const chain = exp.d === base.selected ? base : await chainRetry(sym, exp.d);
          const T = exp.dte / 365;
          const midOf = (o: any): number | null => (o.bid && o.ask ? (o.bid + o.ask) / 2 : o.last);
          const puts = chain.puts.map((p: any) => ({ ...p, m: midOf(p) })).filter((p: any) => p.strike < spot! && p.m && p.m > 0);
          if (puts.length) {
            const atm = puts.reduce((a: any, b: any) => (Math.abs(b.strike - spot!) < Math.abs(a.strike - spot!) ? b : a));
            const ai = ivFromPut(spot, atm.strike, T, R, atm.m);
            atmIV = ai && ai > 0.05 && ai < 2 ? ai : null;
            const kTarget = atmIV ? spot * Math.exp((R + (atmIV * atmIV) / 2) * T - Z_16DELTA * atmIV * Math.sqrt(T)) : spot * 0.9;
            const pick = puts.reduce((a: any, b: any) => (Math.abs(b.strike - kTarget) < Math.abs(a.strike - kTarget) ? b : a));
            const iv = ivFromPut(spot, pick.strike, T, R, pick.m);
            const delta = iv ? putDelta(spot, pick.strike, T, R, iv) : null;
            const yieldPct = (pick.m / pick.strike) * 100;
            put = {
              expiry: exp.d, dte: exp.dte, strike: pick.strike,
              delta: delta != null ? +delta.toFixed(2) : 0,
              iv: iv != null ? +iv.toFixed(3) : atmIV ?? 0,
              premium: +pick.m.toFixed(2), premiumSrc: pick.bid && pick.ask ? "mid" : "last",
              yieldPct: +yieldPct.toFixed(2), annPct: +((yieldPct * 365) / exp.dte).toFixed(1),
              cushionPct: +(((spot - pick.strike) / spot) * 100).toFixed(1),
              breakeven: +(pick.strike - pick.m).toFixed(2),
            };
            // Reject stale/illiquid option prints. A real ~16-delta cash-secured put doesn't yield
            // 75-200%+ annualized — that's a stale last trade on a thin option (or a name in
            // freefall, not one you'd be "happy to own"). Also drop unsolvable/blown-out IVs and
            // strikes that landed nowhere near 16-delta. The name still shows; it just gets no put.
            if (put.iv < 0.05 || put.iv > 1.5 || Math.abs(put.delta) < 0.03 || Math.abs(put.delta) > 0.45 || put.cushionPct < 2.5 || put.annPct > 65) {
              put = null;
            }
          }
        }
      }
    } catch { /* leave put null */ }

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
      rvol: rvol != null ? +rvol.toFixed(3) : null,
      rvolRank: rvolRank != null ? Math.round(rvolRank) : null,
      atmIV: atmIV != null ? +atmIV.toFixed(3) : null,
      ivRank: ivRank != null ? Math.round(ivRank) : null,
      ivPremium: atmIV != null && rvol != null && rvol > 0 ? +(atmIV / rvol).toFixed(2) : null,
      put,
    };
    return cand;
  });

  const candidates = built
    .filter((c): c is PutWriteCandidate => !!c)
    .sort((a, b) => (b.put?.annPct ?? -1) - (a.put?.annPct ?? -1));

  const data: PutWriteData = {
    generatedAt: new Date().toISOString(),
    source: "US large/mid caps (Russell 3000 ∪ S&P 1500 ∪ Nasdaq 100)",
    rfRate: R,
    filters: { minMarketCap: MIN_MKTCAP, minRoe: MIN_ROE, maxPe: MAX_PE },
    candidates,
  };
  await fsp.writeFile(path.join(DATA, "putwrite.json"), JSON.stringify(data));
  await fsp.writeFile(IVHIST, JSON.stringify(ivhist));
  const withPut = candidates.filter((c) => c.put).length;
  console.log(`\nwrote ${candidates.length} candidates (${withPut} with a put suggestion).`);
  console.log("top by annualized yield:");
  for (const c of candidates.slice(0, 8)) console.log(`  ${c.symbol.padEnd(6)} ${c.put ? `$${c.put.strike} put ${c.put.dte}d · ${c.put.annPct}% ann · ${c.put.cushionPct}% cushion` : "—"}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
