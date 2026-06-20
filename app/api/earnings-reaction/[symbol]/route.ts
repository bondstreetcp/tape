import { NextResponse } from "next/server";
import { getEarningsReactions } from "@/lib/earningsReaction";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    const reactions = await getEarningsReactions(decodeURIComponent(symbol).toUpperCase(), 10);
    return NextResponse.json(
      { reactions },
      { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } },
    );
  } catch (e: any) {
    return NextResponse.json({ reactions: [], error: String(e?.message || e) });
  }
}
