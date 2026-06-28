import { NextResponse } from "next/server";
import { getStockTwits } from "@/lib/stocktwits";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    const data = await getStockTwits(symbol);
    return NextResponse.json(
      { data },
      { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } },
    );
  } catch (e: any) {
    return NextResponse.json({ data: null, error: String(e?.message || e) });
  }
}
