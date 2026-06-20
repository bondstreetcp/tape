import { NextRequest, NextResponse } from "next/server";
import { getTranscriptLinks } from "@/lib/transcripts";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const name = req.nextUrl.searchParams.get("name") || symbol;
  try {
    const links = await getTranscriptLinks(name, symbol);
    return NextResponse.json(
      { links },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (e: any) {
    return NextResponse.json({ links: [], error: String(e?.message || e) });
  }
}
