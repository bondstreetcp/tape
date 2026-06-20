import { NextResponse } from "next/server";
import { getEarningsMultiple } from "@/lib/earningsMultiple";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    const chart = await getEarningsMultiple(decodeURIComponent(symbol).toUpperCase());
    return NextResponse.json(
      { chart },
      { headers: { "Cache-Control": "public, s-maxage=43200, stale-while-revalidate=604800" } },
    );
  } catch (e: any) {
    return NextResponse.json({ chart: null, error: String(e?.message || e) });
  }
}
