import { NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);

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
  const years = Math.min(25, Math.max(1, parseInt(new URL(req.url).searchParams.get("years") || "0", 10) || 0));
  const dailyDays = years ? Math.round(years * 366) : 2010; // default ~5.5y
  try {
    const [d, i] = await Promise.all([
      yf
        .chart(sym, { period1: new Date(now - dailyDays * DAY), interval: "1d" }, { validateResult: false })
        .catch(() => null),
      yf
        .chart(sym, { period1: new Date(now - 8 * DAY), interval: "15m", includePrePost: false } as any, { validateResult: false })
        .catch(() => null),
    ]);
    // Cache briefly: this payload also carries the INTRADAY series that 1D/1W charts render, and a
    // long TTL serves yesterday's session as if it were today's (the KOSPI chart showed the prior
    // day's −3% session while the header said +0.6% — the old s-maxage=3600 + 24h SWR did that).
    return NextResponse.json(
      { daily: bars((d as any)?.quotes || []), intraday: bars((i as any)?.quotes || []) },
      { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } },
    );
  } catch (e: any) {
    return NextResponse.json({ daily: [], intraday: [], error: String(e?.message || e) });
  }
}
