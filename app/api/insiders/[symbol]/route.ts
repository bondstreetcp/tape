import { NextRequest, NextResponse } from "next/server";
import { getInsiderTransactions } from "@/lib/edgar";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const sp = req.nextUrl.searchParams;
  const offset = Math.max(0, parseInt(sp.get("offset") || "0", 10) || 0);
  const limit = Math.min(40, Math.max(1, parseInt(sp.get("limit") || "24", 10) || 24));
  try {
    const data = await getInsiderTransactions(decodeURIComponent(symbol).toUpperCase(), offset, limit);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (e: any) {
    return NextResponse.json({
      cik: null,
      transactions: [],
      nextOffset: null,
      totalFilings: 0,
      error: String(e?.message || e),
    });
  }
}
