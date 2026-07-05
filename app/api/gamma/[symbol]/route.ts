import { NextRequest, NextResponse } from "next/server";
import { loadGamma } from "@/lib/gammaFetch";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

async function build(sym: string) {
  const g = await loadGamma(sym);
  if (!g) return null;
  const { gex, spot, expiries } = g;
  return {
    symbol: sym,
    asOf: new Date().toISOString(),
    expiries,
    spot: +spot.toFixed(2),
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
