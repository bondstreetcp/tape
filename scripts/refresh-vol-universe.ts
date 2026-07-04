/**
 * Builds data/vol-universe.json — a BROAD cross-sectional vol probe that widens the Vol Dislocation
 * screener beyond the ~380 curated quality names the put-writing scan already covers.
 *
 * For each name (market-cap floored, and NOT already in putwrite.json): realized vol from the LOCAL daily
 * series (no fetch), then one option-chain pull to solve the ~1M and ~3M ATM implied vols (Yahoo's `iv`
 * field is junk — we back IV out of the mid), a fixed-moneyness skew (7% OTM put IV − 7% OTM call IV) and
 * term crush (front ÷ back ATM IV). Rows are written in the same per-name shape refresh-vol-dislocation
 * consumes; that script merges them with the (richer) putwrite rows, preferring putwrite where both exist.
 *
 * Thin-option small-caps are the risk (junk IV), so we floor market cap + realized/implied vol at 8%,
 * require a few real strikes, and FLAG borderline-liquidity names (`illiquid`) rather than trust them.
 *
 * VOL_UNIVERSE=russell1000 (default) | russell3000. VOL_MIN_MKTCAP overrides the $1B floor.
 * Run: npm run refresh-vol-universe. Wired into the nightly FULL refresh, before refresh-vol-dislocation.
 */
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot, loadSymbolSeries } from "../lib/data";
import { getOptions } from "../lib/options";
import { ivFromPut, ivFromCall, realizedVol, realizedVolRank } from "../lib/putwrite";
import type { VolUniRow, VolUniData } from "../lib/volDislocation";

const DATA = path.join(process.cwd(), "data");
const UNIVERSE = process.env.VOL_UNIVERSE || "russell1000";
const MIN_MKTCAP = Number(process.env.VOL_MIN_MKTCAP || 1e9);
const R = 0.043; // risk-free approx; only affects IV at the margin

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

// GLOBAL rate limiter — serialize the START of every option-chain call ≥350ms apart across all workers
// (Yahoo throttles bursts regardless of per-name retries). Concurrency then only overlaps latency.
let gate: Promise<void> = Promise.resolve();
function throttle(gap = 350): Promise<void> {
  const p = gate.then(() => sleep(gap));
  gate = p;
  return p;
}

async function chainRetry(sym: string, date?: string): Promise<any> {
  for (let i = 0; i < 4; i++) {
    await throttle();
    try { const c = await getOptions(sym, date); if (c.puts.length || (!date && c.expirations.length)) return c; } catch { /* retry */ }
    await sleep(500 + i * 400);
  }
  await throttle();
  return getOptions(sym, date);
}

const midOf = (o: any): number | null => (o.bid && o.ask ? (o.bid + o.ask) / 2 : o.last);

function pickNear(exps: { d: string; dte: number }[], target: number, lo: number, hi: number): { d: string; dte: number } | null {
  const w = exps.filter((e) => e.dte >= lo && e.dte <= hi);
  const src = w.length ? w : exps;
  return src.slice().sort((a, b) => Math.abs(a.dte - target) - Math.abs(b.dte - target))[0] || null;
}

// ATM implied vol (mean of ATM put & call solved from the mid) + a fixed-moneyness skew + a liquidity read
// for one expiry. Returns null if the expiry has no invertible quotes.
async function atmAtExpiry(sym: string, base: any, spot: number, exp: { d: string; dte: number } | null) {
  if (!exp) return null;
  const chain = exp.d === base.selected ? base : await chainRetry(sym, exp.d);
  const T = exp.dte / 365;
  const puts = chain.puts.map((p: any) => ({ ...p, m: midOf(p) })).filter((p: any) => p.m && p.m > 0);
  const calls = chain.calls.map((c: any) => ({ ...c, m: midOf(c) })).filter((c: any) => c.m && c.m > 0);
  if (!puts.length && !calls.length) return null;
  const nearest = (arr: any[], k: number) => arr.reduce((a: any, b: any) => (Math.abs(b.strike - k) < Math.abs(a.strike - k) ? b : a));
  const atmP = puts.length ? nearest(puts, spot) : null;
  const atmC = calls.length ? nearest(calls, spot) : null;
  const ivP = atmP ? ivFromPut(spot, atmP.strike, T, R, atmP.m) : null;
  const ivC = atmC ? ivFromCall(spot, atmC.strike, T, R, atmC.m) : null;
  const ivs = [ivP, ivC].filter((v): v is number => v != null && v > 0.05 && v < 3);
  const atm = ivs.length ? ivs.reduce((a, b) => a + b, 0) / ivs.length : null;
  const atmOI = ((atmP && atmP.oi) || 0) + ((atmC && atmC.oi) || 0);
  // fixed-moneyness skew: ~7% OTM put IV − ~7% OTM call IV (downside richness, in vol pts)
  const otmP = puts.filter((p: any) => p.strike < spot).length ? nearest(puts.filter((p: any) => p.strike < spot), spot * 0.93) : null;
  const otmC = calls.filter((c: any) => c.strike > spot).length ? nearest(calls.filter((c: any) => c.strike > spot), spot * 1.07) : null;
  const opiv = otmP ? ivFromPut(spot, otmP.strike, T, R, otmP.m) : null;
  const ociv = otmC ? ivFromCall(spot, otmC.strike, T, R, otmC.m) : null;
  const skew = opiv != null && ociv != null ? opiv - ociv : null;
  return { atm, skew, atmOI, validStrikes: puts.length + calls.length, dte: exp.dte };
}

async function probe(sym: string, base: any, spot: number) {
  const now = Date.now();
  const exps = base.expirations
    .map((d: string) => ({ d, dte: Math.round((Date.parse(d + "T00:00:00Z") - now) / 86_400_000) }))
    .filter((e: { dte: number }) => e.dte >= 1);
  if (!exps.length) return null;
  const m1 = pickNear(exps, 30, 18, 45);
  const m3 = pickNear(exps, 90, 55, 140);
  const a1 = await atmAtExpiry(sym, base, spot, m1);
  if (!a1 || a1.atm == null) return null;
  const a3 = m3 && m1 && m3.d !== m1.d ? await atmAtExpiry(sym, base, spot, m3) : null;
  const termCrush = a1.atm && a3 && a3.atm ? +(a1.atm / a3.atm).toFixed(3) : null;
  return { atmIV: a1.atm, skew: a1.skew, termCrush, dte1: a1.dte, atmOI: a1.atmOI, validStrikes: a1.validStrikes };
}

async function main() {
  const snap = await loadSnapshot(UNIVERSE);
  if (!snap) { console.error(`vol-universe: no snapshot for '${UNIVERSE}'.`); process.exit(1); }
  const covered = new Set<string>();
  try {
    const pw = JSON.parse(await fsp.readFile(path.join(DATA, "putwrite.json"), "utf8"));
    for (const c of pw.candidates || []) covered.add(c.symbol);
  } catch { /* putwrite may not exist yet */ }
  const pool = snap.stocks.filter((s: any) => s.marketCap > MIN_MKTCAP && !covered.has(s.symbol));
  console.log(`${UNIVERSE}: ${snap.stocks.length} names → ${pool.length} to probe (mktcap>$${(MIN_MKTCAP / 1e9).toFixed(1)}B, excl ${covered.size} putwrite-covered)`);
  const now = Date.now();

  const built = await mapPool(pool, 8, async (s: any) => {
    const sym: string = s.symbol;
    // realized vol from the LOCAL daily series (no fetch)
    const series = await loadSymbolSeries(sym);
    let rvol: number | null = null, rvolRank: number | null = null;
    if (series?.daily?.length) {
      const closes = series.daily.map((d: any) => (Array.isArray(d) ? d[1] : d.c)).filter((c: number) => Number.isFinite(c) && c > 0);
      rvol = realizedVol(closes, 20);
      rvolRank = realizedVolRank(closes, 20, 252);
    }
    if (rvol == null || !(rvol >= 0.08)) return null; // no reliable realized vol → can't form the premium

    let spot: number | null = null, pr: Awaited<ReturnType<typeof probe>> = null;
    try {
      const base = await chainRetry(sym);
      spot = base.underlying ?? s.price ?? null;
      if (spot && base.expirations.length) pr = await probe(sym, base, spot);
    } catch { /* leave pr null */ }
    if (!pr || pr.atmIV == null || !(pr.atmIV >= 0.08)) return null;

    const de = s.earningsDate && !Number.isNaN(Date.parse(s.earningsDate)) ? Math.round((Date.parse(s.earningsDate) - now) / 86_400_000) : null;
    const earningsDriven = de != null && de >= 0 && pr.dte1 != null && de <= pr.dte1 + 2;
    const illiquid = pr.atmOI < 50 || pr.validStrikes < 8;
    const row: VolUniRow = {
      symbol: sym,
      name: s.name,
      sector: s.sector || "—",
      price: +((spot ?? s.price) as number).toFixed(2),
      marketCap: s.marketCap,
      atmIV: +pr.atmIV.toFixed(3),
      rvol: +rvol.toFixed(3),
      ivPremium: +(pr.atmIV / rvol).toFixed(2),
      termCrush: pr.termCrush,
      skew: pr.skew != null ? +pr.skew.toFixed(4) : null,
      ivRank: null,
      rvolRank: rvolRank != null ? Math.round(rvolRank) : null,
      daysToEarnings: de,
      earningsDriven,
      illiquid,
    };
    return row;
  });

  const rows = built.filter((r): r is VolUniRow => !!r).sort((a, b) => b.ivPremium - a.ivPremium);
  const out: VolUniData = { generatedAt: new Date().toISOString(), universe: UNIVERSE, scanned: rows.length, rows };
  await fsp.writeFile(path.join(DATA, "vol-universe.json"), JSON.stringify(out));
  const liq = rows.filter((r) => !r.illiquid).length;
  console.log(`wrote ${rows.length} vol-universe rows (${liq} liquid, ${rows.length - liq} illiquid-flagged).`);
}

main().catch((e) => { console.error(e); process.exit(1); });
