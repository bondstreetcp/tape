import { NextRequest, NextResponse } from "next/server";
import { getOptions } from "@/lib/options";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const date = req.nextUrl.searchParams.get("date") || undefined;
  try {
    const data = await getOptions(decodeURIComponent(symbol).toUpperCase(), date);
    return NextResponse.json(data, {
      headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=3600" },
    });
  } catch (e: any) {
    return NextResponse.json({
      underlying: null,
      expirations: [],
      selected: null,
      calls: [],
      puts: [],
      error: String(e?.message || e),
    });
  }
}
