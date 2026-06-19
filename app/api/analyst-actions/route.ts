import { NextRequest, NextResponse } from "next/server";
import { getAnalystActions } from "@/lib/analystActions";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const universe = req.nextUrl.searchParams.get("universe") || "sp500";
  try {
    const actions = await getAnalystActions(universe);
    return NextResponse.json(
      { actions },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (e: any) {
    return NextResponse.json({ actions: [], error: String(e?.message || e) });
  }
}
