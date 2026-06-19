import { NextRequest, NextResponse } from "next/server";
import { getNews } from "@/lib/news";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams.get("q") || "market";
  const count = Math.min(30, Math.max(1, parseInt(req.nextUrl.searchParams.get("count") || "12", 10) || 12));
  const query = q.toLowerCase() === "market" ? "stock market today" : q;
  try {
    const news = await getNews(query, count);
    return NextResponse.json(
      { news },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=3600" } },
    );
  } catch (e: any) {
    return NextResponse.json({ news: [], error: String(e?.message || e) });
  }
}
