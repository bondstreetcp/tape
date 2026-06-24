import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import { loadSnapshot } from "@/lib/data";
import { ETF_TO_SECTOR } from "@/lib/sectors";
import { buildIndustryIndex } from "@/lib/aggregate";
import type { XY } from "@/lib/types";

/**
 * LIVE intraday sub-industry indices for a sector. The static per-symbol intraday series only
 * rebuilds after the close, so the 1D/1W comparison chart would otherwise show the prior session;
 * this fetches fresh 15-minute bars on demand and rebuilds the cap-weighted indices with the same
 * lib the page uses. Capped to the top constituents by market cap (a cap-weighted index is
 * dominated by them) and throttled so Yahoo doesn't rate-limit the burst. Cached briefly.
 */
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DAY = 86_400_000;
const TOP = 60; // constituents per sector to pull live (cap-weighted ⇒ the tail is negligible)

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let gate: Promise<void> = Promise.resolve();
const throttle = (gap = 200): Promise<void> => { const p = gate.then(() => sleep(gap)); gate = p; return p; };

async function intradayOf(symbol: string, interval: string, days: number): Promise<XY[]> {
  await throttle();
  try {
    const ch: any = await yf.chart(symbol, { period1: new Date(Date.now() - days * DAY), interval, includePrePost: false } as any, { validateResult: false });
    return (ch.quotes || []).filter((q: any) => q?.date && q.close != null).map((q: any) => [new Date(q.date).getTime(), q.close] as XY);
  } catch { return []; }
}

async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  const universe = p.get("universe") || "";
  const etf = (p.get("etf") || "").toUpperCase();
  if (!ETF_TO_SECTOR[etf]) return NextResponse.json({ industries: {}, etf: [] });
  const snap = await loadSnapshot(universe);
  if (!snap) return NextResponse.json({ industries: {}, etf: [] });

  const stocks = snap.stocks
    .filter((s) => s.etf === etf)
    .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0))
    .slice(0, TOP);
  const symbols = [...stocks.map((s) => s.symbol), etf];
  // 1D → fine 5-minute bars (~2 days); else 15-minute (8 days). See /api/intraday for the rationale.
  const fine = p.get("interval") === "5m";
  const interval = fine ? "5m" : "15m", days = fine ? 2 : 8;
  const fetched = await mapPool(symbols, 8, (s) => intradayOf(s, interval, days));
  const liveBy: Record<string, XY[]> = {};
  symbols.forEach((s, i) => { liveBy[s] = fetched[i] || []; });

  const byIndustry = new Map<string, typeof stocks>();
  for (const s of stocks) { const a = byIndustry.get(s.industry) ?? []; a.push(s); byIndustry.set(s.industry, a); }

  const industries: Record<string, XY[]> = {};
  for (const [industry, rows] of byIndustry) {
    const inputs = rows
      .filter((r) => liveBy[r.symbol]?.length)
      .map((r) => ({ cap: r.marketCap || 0, daily: [] as XY[], intraday: liveBy[r.symbol] }));
    if (!inputs.length) continue;
    const idx = buildIndustryIndex(inputs);
    if (idx.intraday.length) industries[industry] = idx.intraday.map((pt) => [pt.t, pt.c] as XY);
  }

  return NextResponse.json(
    { industries, etf: liveBy[etf] || [] },
    { headers: { "Cache-Control": fine ? "public, s-maxage=30, stale-while-revalidate=60" : "public, s-maxage=120, stale-while-revalidate=300" } },
  );
}
