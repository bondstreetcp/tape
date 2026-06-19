import { NextRequest, NextResponse } from "next/server";
import { getOptions, getTermStructure } from "@/lib/options";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const sp = req.nextUrl.searchParams;
  try {
    if (sp.get("term")) {
      const term = await getTermStructure(sym);
      return NextResponse.json(term, {
        headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" },
      });
    }
    const data = await getOptions(sym, sp.get("date") || undefined);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" },
    });
  } catch (e: any) {
    return NextResponse.json({
      underlying: null,
      expirations: [],
      selected: null,
      calls: [],
      puts: [],
      error: String(e?.message || e),
    });
  }
}
