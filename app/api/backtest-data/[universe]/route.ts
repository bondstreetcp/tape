import { NextResponse } from "next/server";
import { buildMonthlyMatrix } from "@/lib/backtestData";

export const dynamic = "force-dynamic";
export const maxDuration = 40;

export async function GET(_req: Request, { params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  try {
    const matrix = await buildMonthlyMatrix(universe, 200);
    return NextResponse.json(
      { matrix },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=604800" } },
    );
  } catch (e: any) {
    return NextResponse.json({ matrix: null, error: String(e?.message || e) });
  }
}
