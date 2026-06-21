import { NextResponse } from "next/server";
import { getSharesHistory } from "@/lib/sharesHistory";

// Shares outstanding changes at most quarterly — cache a day.
export const revalidate = 86400;

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const data = await getSharesHistory(symbol.toUpperCase());
  return NextResponse.json(data);
}
