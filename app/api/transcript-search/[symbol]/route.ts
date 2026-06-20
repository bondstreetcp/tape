import { NextRequest, NextResponse } from "next/server";
import { searchTranscripts } from "@/lib/transcripts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const p = req.nextUrl.searchParams;
  const q = p.get("q") || "";
  const name = p.get("name") || symbol;
  try {
    const matches = await searchTranscripts(symbol, name, q);
    return NextResponse.json(
      { matches },
      { headers: { "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=604800" } },
    );
  } catch (e: any) {
    return NextResponse.json({ matches: [], error: String(e?.message || e) });
  }
}
