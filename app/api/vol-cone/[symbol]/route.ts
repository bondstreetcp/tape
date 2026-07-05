import { NextRequest, NextResponse } from "next/server";
import { loadSymbolSeries } from "@/lib/data";
import { buildVolCone, type Daily } from "@/lib/volCone";

export const dynamic = "force-dynamic";

/** Per-name realized-vol cone (full bands) for the stock page's Options tab. Pure local math off the
 *  stored price series — the client overlays the live IV term structure it already fetched. */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const series = await loadSymbolSeries(sym).catch(() => null);
  const daily = series?.daily;
  if (!Array.isArray(daily) || daily.length < 60) {
    return NextResponse.json({ error: "no history" }, { headers: { "Cache-Control": "public, s-maxage=300" } });
  }
  const row = buildVolCone(sym, "", "", daily as Daily);
  if (!row) return NextResponse.json({ error: "no cone" }, { headers: { "Cache-Control": "public, s-maxage=300" } });
  return NextResponse.json(
    { symbol: sym, bands: row.bands, hist: row.hist, asOf: new Date().toISOString() },
    { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } },
  );
}
