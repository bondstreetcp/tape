import { NextRequest, NextResponse } from "next/server";
import { getOptions } from "@/lib/options";
import { ivFromPrice } from "@/lib/blackScholes";
import { fitSmile, type SmileFit, type SmilePoint } from "@/lib/volSurface";
import { riskNeutralDensity } from "@/lib/riskNeutral";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MONEYNESS = [-0.25, -0.2, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.15, 0.2, 0.25]; // display grid (K/F − 1)
const MAX_EXP = 8; // expiries sampled across the chain
const FIT_BAND = 0.4; // |ln(K/F)| kept for the fit (~±49% strike) — center where quotes are real

const mid = (o: { bid: number | null; ask: number | null; last: number | null }): number | null =>
  o.bid != null && o.ask != null && o.bid > 0 && o.ask > 0 ? (o.bid + o.ask) / 2 : o.last != null && o.last > 0 ? o.last : null;

async function buildSurface(sym: string) {
  const base = await getOptions(sym).catch(() => null);
  if (!base?.underlying || !base.expirations?.length) return null;
  const S = base.underlying;
  const now = Date.now();
  const future = base.expirations.filter((e) => Date.parse(e + "T00:00:00Z") - now > 0.5 * 86_400_000);
  if (!future.length) return null;
  // Sample up to MAX_EXP expiries evenly across the open set (keeps the near-term dense + the far tail).
  const step = Math.max(1, Math.floor(future.length / MAX_EXP));
  const picks: string[] = [];
  for (let i = 0; i < future.length && picks.length < MAX_EXP; i += step) picks.push(future[i]);
  const last = future[future.length - 1];
  if (!picks.includes(last) && picks.length < MAX_EXP) picks.push(last);

  const chains = await Promise.all(picks.map((e) => (e === base.selected ? Promise.resolve(base) : getOptions(sym, e).catch(() => null))));
  const perExp: { date: string; dte: number; fit: SmileFit }[] = [];
  for (const ch of chains) {
    if (!ch?.selected || !ch.underlying) continue;
    const T = (Date.parse(ch.selected + "T00:00:00Z") - now) / (365 * 86_400_000);
    if (T <= 0) continue;
    const F = S; // forward ≈ spot for a display surface (carry ignored)
    const strikes = [...new Set([...ch.calls, ...ch.puts].map((o) => o.strike))].sort((a, b) => a - b);
    const pts: SmilePoint[] = [];
    for (const K of strikes) {
      const k = Math.log(K / F);
      if (Math.abs(k) > FIT_BAND) continue;
      const useCall = K >= F; // OTM side: calls above spot, puts below — the liquid, parity-clean quotes
      const o = (useCall ? ch.calls : ch.puts).find((x) => x.strike === K);
      if (!o) continue;
      const m = mid(o);
      if (m == null) continue;
      const iv = ivFromPrice(useCall ? "call" : "put", S, K, T, m);
      if (iv == null || iv < 0.02 || iv > 4) continue;
      const twoSided = o.bid != null && o.ask != null && o.bid > 0 && o.ask > 0;
      const weight = (Math.log1p(o.oi ?? 0) + 0.5) * (twoSided ? 1 : 0.35); // liquidity: OI + a two-sided-quote bonus
      pts.push({ strike: K, moneyness: K / F - 1, k, iv, weight });
    }
    const fit = fitSmile(pts, T);
    if (fit) perExp.push({ date: ch.selected, dte: Math.round(T * 365), fit });
  }
  if (!perExp.length) return null;

  // Risk-neutral (Breeden–Litzenberger) density per expiry — the market's implied price distribution at
  // expiry, read off each fitted smile. Compact [price, density] pairs + the implied percentiles/skew.
  const dist = perExp
    .map((pe) => {
      const rnd = riskNeutralDensity(pe.fit.ivAt, S, pe.fit.T, 0.04, 81, 3.5);
      if (!rnd) return null;
      return {
        date: pe.date,
        dte: pe.dte,
        pts: rnd.points.map((p) => [+p.price.toFixed(2), +p.density.toFixed(6)] as [number, number]),
        p05: +rnd.p05.toFixed(2),
        p16: +rnd.p16.toFixed(2),
        p50: +rnd.p50.toFixed(2),
        p84: +rnd.p84.toFixed(2),
        p95: +rnd.p95.toFixed(2),
        pUp: +rnd.pUp.toFixed(3),
        skew: +rnd.skew.toFixed(3),
      };
    })
    .filter((x): x is NonNullable<typeof x> => x != null);

  const grid = perExp.map((pe) => MONEYNESS.map((m) => +(pe.fit.ivAt(Math.log(1 + m)) * 100).toFixed(1)));
  const richCheap = perExp
    .flatMap((pe) => pe.fit.strikes.map((s) => ({ expiry: pe.date, dte: pe.dte, ...s })))
    .filter((r) => Math.abs(r.residual) >= 0.005) // ≥ 0.5 vol pts off the fitted smile
    .sort((a, b) => Math.abs(b.residual) - Math.abs(a.residual))
    .slice(0, 12)
    .map((r) => ({ expiry: r.expiry, dte: r.dte, strike: r.strike, moneyness: +(r.moneyness * 100).toFixed(1), observedIV: +(r.observedIV * 100).toFixed(1), fittedIV: +(r.fittedIV * 100).toFixed(1), residPts: +(r.residual * 100).toFixed(1) }));

  return {
    symbol: sym,
    spot: +S.toFixed(2),
    asOf: new Date().toISOString(),
    moneyness: MONEYNESS.map((m) => Math.round(m * 100)),
    expiries: perExp.map((pe) => ({
      date: pe.date,
      dte: pe.dte,
      atmVol: pe.fit.atmVol != null ? +(pe.fit.atmVol * 100).toFixed(1) : null,
      skewPer10: pe.fit.skewPer10 != null ? +(pe.fit.skewPer10 * 100).toFixed(2) : null,
      rmse: +(pe.fit.rmse * 100).toFixed(2),
      n: pe.fit.n,
    })),
    grid, // expiries × moneyness → fitted IV %
    richCheap,
    dist, // per-expiry risk-neutral density (Breeden–Litzenberger)
  };
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  try {
    const data = await buildSurface(sym);
    if (!data) return NextResponse.json({ error: "no surface" }, { headers: { "Cache-Control": "public, s-maxage=300" } });
    return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) });
  }
}
