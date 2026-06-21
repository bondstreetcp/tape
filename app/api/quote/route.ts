import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";

// Live batch quotes from Yahoo (reachable from Vercel) — powers the live watchlist,
// independent of the nightly snapshots.
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const n = (v: any): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const raw = req.nextUrl.searchParams.get("symbols") || "";
  const symbols = [...new Set(raw.split(",").map((s) => s.trim()).filter(Boolean))].slice(0, 80);
  if (!symbols.length) return NextResponse.json({ quotes: [] });
  try {
    const res: any = await yf.quote(symbols, {}, { validateResult: false });
    const arr: any[] = Array.isArray(res) ? res : [res];
    const quotes = arr.map((q) => {
      const state: string = q.marketState || "";
      const ext =
        state === "PRE" ? { p: n(q.preMarketPrice), c: n(q.preMarketChangePercent) }
        : state === "POST" || state === "POSTPOST" ? { p: n(q.postMarketPrice), c: n(q.postMarketChangePercent) }
        : null;
      return {
        symbol: q.symbol,
        price: n(q.regularMarketPrice),
        change: n(q.regularMarketChange),
        changePct: n(q.regularMarketChangePercent),
        prevClose: n(q.regularMarketPreviousClose),
        state,
        extPrice: ext?.p ?? null,
        extChangePct: ext?.c ?? null,
        time: q.regularMarketTime ? new Date(q.regularMarketTime).getTime() : null,
      };
    });
    return NextResponse.json({ quotes }, { headers: { "Cache-Control": "no-store" } });
  } catch (e: any) {
    return NextResponse.json({ quotes: [], error: String(e?.message || e).slice(0, 160) });
  }
}
