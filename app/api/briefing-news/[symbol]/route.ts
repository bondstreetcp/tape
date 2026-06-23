import { NextRequest, NextResponse } from "next/server";
import { briefingStoriesFor } from "@/lib/briefing";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Stories from today's Reuters briefing that name this company (matched on the company name
// passed as ?name=…). Fetched live and cached in-process — nothing is persisted.
export async function GET(req: NextRequest) {
  const name = req.nextUrl.searchParams.get("name") || "";
  if (!name.trim()) return NextResponse.json({ stories: [] });
  try {
    const stories = await briefingStoriesFor(name);
    return NextResponse.json(
      { stories },
      { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } },
    );
  } catch {
    return NextResponse.json({ stories: [] });
  }
}
