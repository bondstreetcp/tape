import { NextResponse } from "next/server";
import { getSegments } from "@/lib/segments";

export const dynamic = "force-dynamic";
export const maxDuration = 25;

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    const segments = await getSegments(decodeURIComponent(symbol).toUpperCase());
    return NextResponse.json(
      { segments },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (e: any) {
    return NextResponse.json({ segments: null, error: String(e?.message || e) });
  }
}
