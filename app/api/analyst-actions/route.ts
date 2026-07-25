import { NextRequest, NextResponse } from "next/server";
import { getAnalystActionsDetailed } from "@/lib/analystActions";
import { memo } from "@/lib/memoCache";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const universe = req.nextUrl.searchParams.get("universe") || "sp500";
  try {
    // The single most expensive route on the site: AnalystFeed mounts on EVERY home-page view and a
    // miss runs ~140 Yahoo quoteSummary calls (topN=140 through a pool of 8). The CDN hid that on
    // Vercel; on the NAS every visit re-paid it — minutes of uplink, and a genuine rate-limit hazard
    // (a 429 storm is what emptied estimates.json this week). One compute per universe per hour now,
    // with concurrent viewers sharing the in-flight run.
    //
    // cacheIf gates on COVERAGE, not on length. A row count can't distinguish "a quiet week for
    // rating changes" from "120 of 140 fetches were throttled" — both yield a short, well-formed
    // array — so a length check would happily pin a degraded scan for the full hour. Requiring 80%
    // of the fetches to have succeeded means a throttled run is returned to THIS caller but not
    // cached, and the next view re-fetches instead of inheriting the damage.
    const { actions, ok, attempted } = await memo(
      `analyst-actions:${universe}`,
      3_600_000,
      () => getAnalystActionsDetailed(universe),
      { cacheIf: (r) => r.attempted > 0 && r.ok / r.attempted >= 0.8 },
    );
    if (attempted > 0 && ok / attempted < 0.8) {
      console.warn(`analyst-actions ${universe}: only ${ok}/${attempted} fetches succeeded — serving uncached (likely throttled)`);
    }
    return NextResponse.json(
      { actions },
      { headers: { "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400" } },
    );
  } catch (e: any) {
    return NextResponse.json({ actions: [], error: String(e?.message || e) });
  }
}
