import { NextResponse } from "next/server";
import { fetchLiveMarketHeadlines, getMarketHeadlines } from "@/lib/marketHeadlinesFetch";
import { memo } from "@/lib/memoCache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Live macro / market / geopolitical headlines — fetched fresh from Google News behind a 5-min memo, so
// the wire is ~5-min live rather than baked hourly. Falls back to the committed data/market-headlines.json
// (the nightly seed) if the live fetch returns nothing, so the wire never blanks. Keyless, no LLM.
export async function GET() {
  const headlines = await memo(
    "market-headlines:live",
    300_000, // 5 minutes
    async () => {
      const live = await fetchLiveMarketHeadlines(60).catch(() => []);
      return live.length ? live : await getMarketHeadlines(60).catch(() => []);
    },
    { cacheIf: (v) => Array.isArray(v) && v.length > 0 }, // never cache an empty result
  );
  return NextResponse.json(
    { headlines },
    { headers: { "Cache-Control": "public, s-maxage=300, stale-while-revalidate=900" } },
  );
}
