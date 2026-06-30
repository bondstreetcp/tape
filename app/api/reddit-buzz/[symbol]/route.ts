import { NextResponse } from "next/server";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ApeWisdomData } from "@/lib/apewisdom";

export const dynamic = "force-dynamic";

// Per-ticker Reddit buzz (ApeWisdom), read from the nightly snapshot. Returns null for the ~vast
// majority of names that aren't being talked about — that absence is the signal.
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  try {
    const p = join(process.cwd(), "data", "apewisdom.json");
    if (!existsSync(p)) return NextResponse.json({ buzz: null });
    const data = JSON.parse(readFileSync(p, "utf8")) as ApeWisdomData;
    return NextResponse.json(
      { buzz: data.byTicker?.[sym] ?? null, asOf: data.generatedAt },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch {
    return NextResponse.json({ buzz: null });
  }
}
