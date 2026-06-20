import { NextResponse } from "next/server";
import { getNews } from "@/lib/news";
import { getRatings } from "@/lib/ratings";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

/**
 * Aggregated feed for an industry / sub-industry / sector page: recent news and
 * analyst rating changes across a set of constituent tickers. `?tickers=` is a
 * comma list (we use the largest few for news, a few more for ratings).
 */
export async function GET(req: Request) {
  const tickers = (new URL(req.url).searchParams.get("tickers") || "")
    .split(",").map((s) => s.trim().toUpperCase()).filter(Boolean).slice(0, 12);
  if (!tickers.length) return NextResponse.json({ news: [], actions: [] });

  const [newsLists, ratingLists] = await Promise.all([
    Promise.all(tickers.slice(0, 6).map((t) => getNews(t, 4).catch(() => []))),
    Promise.all(
      tickers.slice(0, 10).map((t) =>
        getRatings(t)
          .then((r) => (r?.changes || []).slice(0, 4).map((c) => ({ date: c.date, firm: c.firm, action: c.action, toGrade: c.toGrade, targetTo: c.targetTo, symbol: t })))
          .catch(() => []),
      ),
    ),
  ]);

  const seen = new Set<string>();
  const news = newsLists.flat()
    .filter((n) => (seen.has(n.link) ? false : (seen.add(n.link), true)))
    .sort((a, b) => (b.time ? Date.parse(b.time) : 0) - (a.time ? Date.parse(a.time) : 0))
    .slice(0, 12);
  const actions = ratingLists.flat().sort((a, b) => b.date.localeCompare(a.date)).slice(0, 14);

  return NextResponse.json(
    { news, actions },
    { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } },
  );
}
