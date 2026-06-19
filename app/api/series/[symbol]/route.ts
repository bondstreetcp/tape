import { NextResponse } from "next/server";
import { loadSymbolSeries } from "@/lib/data";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const series = await loadSymbolSeries(symbol);
  if (!series) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json(series);
}
