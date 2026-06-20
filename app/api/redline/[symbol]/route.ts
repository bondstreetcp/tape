import { NextRequest, NextResponse } from "next/server";
import { getRedline } from "@/lib/redline";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const form = req.nextUrl.searchParams.get("form") === "10-Q" ? "10-Q" : "10-K";
  try {
    const redline = await getRedline(symbol, form);
    return NextResponse.json(redline, {
      headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" },
    });
  } catch (e: any) {
    return NextResponse.json({ available: false, note: String(e?.message || e), blocks: [] });
  }
}
