import { NextRequest, NextResponse } from "next/server";
import { searchFilings } from "@/lib/docsearch";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const q = p.get("q") || "";
  try {
    const result = await searchFilings(q, {
      ticker: p.get("ticker") || undefined,
      forms: p.get("forms") || undefined,
      from: Number(p.get("from")) || 0,
    });
    return NextResponse.json(result, {
      headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" },
    });
  } catch (e: any) {
    return NextResponse.json({ query: q, total: 0, hits: [], from: 0, nextFrom: null, error: String(e?.message || e) });
  }
}
