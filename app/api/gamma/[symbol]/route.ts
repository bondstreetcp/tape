import { NextRequest, NextResponse } from "next/server";
import { getOptions } from "@/lib/options";
import { ivFromPrice } from "@/lib/blackScholes";
import { computeGamma, type GammaContract } from "@/lib/gammaExposure";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

const MAX_EXP = 4; // near expiries carry the bulk of dealer gamma
const BAND = 0.4; // |ln(K/S)| — ignore deep-OTM strikes (negligible gamma + junk quotes)

const mid = (o: { bid: number | null; ask: number | null; last: number | null }): number | null =>
  o.bid != null && o.ask != null && o.bid > 0 && o.ask > 0 ? (o.bid + o.ask) / 2 : o.last != null && o.last > 0 ? o.last : null;

async function build(sym: string) {
  const base = await getOptions(sym).catch(() => null);
  if (!base?.underlying || !base.expirations?.length) return null;
  const S = base.underlying;
  const now = Date.now();
  const future = base.expirations.filter((e) => Date.parse(e + "T00:00:00Z") - now > 0.5 * 86_400_000).sort();
  if (!future.length) return null;
  const picks = future.slice(0, MAX_EXP);
  const chains = await Promise.all(picks.map((e) => (e === base.selected ? Promise.resolve(base) : getOptions(sym, e).catch(() => null))));

  const contracts: GammaContract[] = [];
  const usedExp: { date: string; dte: number }[] = [];
  for (const ch of chains) {
    if (!ch?.selected || !ch.underlying) continue;
    const T = (Date.parse(ch.selected + "T00:00:00Z") - now) / (365 * 86_400_000);
    if (T <= 0) continue;
    let any = false;
    for (const kind of ["call", "put"] as const) {
      for (const o of kind === "call" ? ch.calls : ch.puts) {
        const oi = o.oi;
        if (!(oi != null && oi > 0)) continue;
        if (Math.abs(Math.log(o.strike / S)) > BAND) continue;
        const m = mid(o);
        let sig = m != null && m > 0 ? ivFromPrice(kind, S, o.strike, T, m) : null;
        if (sig == null || sig <= 0) sig = o.iv != null && o.iv > 0 ? o.iv : null;
        if (sig == null || sig < 0.02 || sig > 4) continue;
        contracts.push({ kind, strike: o.strike, T, sig, oi });
        any = true;
      }
    }
    if (any) usedExp.push({ date: ch.selected, dte: Math.round(T * 365) });
  }
  if (contracts.length < 4) return null;
  const gex = computeGamma(contracts, S, 0.25);
  if (!gex) return null;

  return {
    symbol: sym,
    asOf: new Date().toISOString(),
    expiries: usedExp,
    spot: +S.toFixed(2),
    totalGex: Math.round(gex.totalGex),
    grossGex: Math.round(gex.grossGex),
    flip: gex.flip != null ? +gex.flip.toFixed(2) : null,
    pcRatio: gex.pcRatio != null ? +gex.pcRatio.toFixed(2) : null,
    callWall: gex.callWall,
    putWall: gex.putWall,
    strikes: gex.strikes.map((s) => ({ strike: s.strike, gex: Math.round(s.gex), callOI: s.callOI, putOI: s.putOI })),
  };
}

export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  try {
    const data = await build(sym);
    if (!data) return NextResponse.json({ error: "no gamma" }, { headers: { "Cache-Control": "public, s-maxage=300" } });
    return NextResponse.json(data, { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e) });
  }
}
