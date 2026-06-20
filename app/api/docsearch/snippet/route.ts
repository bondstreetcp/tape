import { NextRequest, NextResponse } from "next/server";
import { getDocSnippet } from "@/lib/docsearch";

export const dynamic = "force-dynamic";
export const maxDuration = 20;

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get("url") || "";
  const q = req.nextUrl.searchParams.get("q") || "";
  try {
    const snippet = await getDocSnippet(url, q);
    return NextResponse.json(
      { snippet },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (e: any) {
    return NextResponse.json({ snippet: null, error: String(e?.message || e) });
  }
}
