import { NextResponse } from "next/server";
import { getRatings } from "@/lib/ratings";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    const ratings = await getRatings(decodeURIComponent(symbol).toUpperCase());
    return NextResponse.json(
      { ratings },
      { headers: { "Cache-Control": "public, s-maxage=10800, stale-while-revalidate=86400" } },
    );
  } catch (e: any) {
    return NextResponse.json({ ratings: null, error: String(e?.message || e) });
  }
}
