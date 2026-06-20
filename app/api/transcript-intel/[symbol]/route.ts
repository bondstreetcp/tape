import { NextRequest, NextResponse } from "next/server";
import { getTranscriptIntel, DEFAULT_KEYWORDS } from "@/lib/transcriptIntel";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const p = req.nextUrl.searchParams;
  const name = p.get("name") || symbol;
  const kwParam = p.get("keywords");
  const keywords = kwParam ? kwParam.split(",").map((k) => k.trim()).filter(Boolean) : DEFAULT_KEYWORDS;
  try {
    const intel = await getTranscriptIntel(symbol, name, keywords);
    return NextResponse.json(intel, {
      headers: { "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=604800" },
    });
  } catch (e: any) {
    return NextResponse.json({ available: false, symbol, keywords, calls: [], note: String(e?.message || e) });
  }
}
