import { NextResponse } from "next/server";
import { yahoo } from "@/lib/yahooClient";
import { memo } from "@/lib/memoCache";


export const dynamic = "force-dynamic";
export const maxDuration = 20;

const DAY = 86_400_000;

interface Bar {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

function bars(quotes: any[]): Bar[] {
  return (quotes || [])
    .filter((q) => q && q.date && q.close != null && q.open != null && q.high != null && q.low != null)
    .map((q) => ({
      t: new Date(q.date).getTime(),
      o: q.open,
      h: q.high,
      l: q.low,
      c: q.close,
      v: q.volume ?? 0,
    }))
    .sort((a, b) => a.t - b.t);
}

export async function GET(
  req: Request,
  { params }: { params: Promise<{ symbol: string }> },
) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const now = Date.now();
  // ⚠ `years` must stay 0 when absent. The old clamp was Math.max(1, …), which can never BE 0, so the
  // documented "~5.5y default" branch below was dead code and a request with no ?years= silently got
  // ONE year — the stock page's longer tenors rendered a year of bars. Clamp only when a value was
  // actually supplied.
  const yearsParam = parseInt(new URL(req.url).searchParams.get("years") || "0", 10) || 0;
  const years = yearsParam > 0 ? Math.min(25, yearsParam) : 0;
  const dailyDays = years ? Math.round(years * 366) : 2010; // default ~5.5y
  try {
    // The site's most-mounted API — 8 call sites (every stock-page Overview, the home index chart,
    // /rotation's 12 parallel fetches, compare, ratio, insiders, indicators). Two live Yahoo chart
    // calls per miss. The s-maxage below was tuned FOR the Vercel CDN and is inert on the NAS, so the
    // memo is what actually restores "one fetch per symbol per 10 min" — matched to that same TTL.
    //
    // The two legs are memoized SEPARATELY, for three reasons a single combined entry got wrong:
    //  - a HALF-failed pair (daily ok, intraday threw) passed a daily-only cacheIf and pinned an
    //    EMPTY intraday chart for the full 10 minutes — and overwrote the previous good one;
    //  - the 15m leg's window is a fixed `now - 8d` and does NOT depend on `years`, so keying it by
    //    years re-fetched identical bars once per distinct tenor;
    //  - each leg now caches only when IT succeeded, so one failing leg can't suppress the other.
    // We also cache the SERIALIZED bars rather than the raw Yahoo payload: the raw objects carry the
    // full quote/meta graph, which behind an 800-entry bound is hundreds of MB of retained heap.
    const [d, i] = await Promise.all([
      memo(
        `ohlc:d:${sym}:${years}`,
        600_000,
        async () =>
          bars(
            ((await yahoo
              .chart(sym, { period1: new Date(now - dailyDays * DAY), interval: "1d" }, { validateResult: false })
              .catch(() => null)) as any)?.quotes || [],
          ),
        { cacheIf: (b) => b.length > 0 },
      ),
      memo(
        `ohlc:i:${sym}`,
        600_000,
        async () =>
          bars(
            ((await yahoo
              .chart(sym, { period1: new Date(now - 8 * DAY), interval: "15m", includePrePost: false } as any, { validateResult: false })
              .catch(() => null)) as any)?.quotes || [],
          ),
        { cacheIf: (b) => b.length > 0 },
      ),
    ]);
    // Cache tuned between two failures: a LONG TTL served yesterday's session as today's (the KOSPI
    // stale-chart bug — old 1h + 24h SWR), but a 2-min TTL made every chart poll hit the function and
    // was a Fluid-CPU driver. 10-min s-maxage + 1-day SWR: the CDN serves polls from cache (revalidating
    // in the background), the function runs ~6×/hour per symbol, and the chart is never a day stale.
    return NextResponse.json(
      { daily: d, intraday: i }, // already serialized bars — each leg was mapped inside its own memo
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400" } },
    );
  } catch (e: any) {
    return NextResponse.json({ daily: [], intraday: [], error: String(e?.message || e) });
  }
}
