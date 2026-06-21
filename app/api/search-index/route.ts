import { NextResponse } from "next/server";
import { getGlobalSearchIndex } from "@/lib/searchIndex";

// Global company index for the search box (all universes). Static per deploy → cache hard.
export const revalidate = 3600;

export async function GET() {
  const index = await getGlobalSearchIndex();
  return NextResponse.json(index, {
    headers: { "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400" },
  });
}
