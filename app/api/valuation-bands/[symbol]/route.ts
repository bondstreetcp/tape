import { NextResponse } from "next/server";
import { getValuationBands } from "@/lib/valuationBands";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    const bands = await getValuationBands(decodeURIComponent(symbol).toUpperCase());
    return NextResponse.json(
      { bands },
      { headers: { "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=604800" } },
    );
  } catch (e: any) {
    return NextResponse.json({ bands: null, error: String(e?.message || e) });
  }
}
