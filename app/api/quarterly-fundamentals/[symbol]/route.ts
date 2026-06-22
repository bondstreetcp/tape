import { NextResponse } from "next/server";
import { getQuarterlyHistory } from "@/lib/financials";

// Quarterly fundamentals change at most quarterly — cache a day.
export const revalidate = 86400;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const quarters = await getQuarterlyHistory(symbol.toUpperCase());
  return NextResponse.json({ quarters });
}
