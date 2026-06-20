import { NextRequest, NextResponse } from "next/server";
import { getLatestTranscript } from "@/lib/transcripts";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const name = req.nextUrl.searchParams.get("name") || symbol;
  try {
    const transcript = await getLatestTranscript(symbol, name);
    return NextResponse.json(
      { transcript },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (e: any) {
    return NextResponse.json({ transcript: null, error: String(e?.message || e) });
  }
}
