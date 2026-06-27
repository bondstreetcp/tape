import { NextResponse } from "next/server";
import { getBorrow } from "@/lib/borrow";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    const borrow = await getBorrow(symbol);
    return NextResponse.json(
      { borrow },
      { headers: { "Cache-Control": "public, s-maxage=900, stale-while-revalidate=3600" } },
    );
  } catch (e: any) {
    return NextResponse.json({ borrow: null, error: String(e?.message || e) });
  }
}
