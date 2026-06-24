import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import type { XY } from "@/lib/types";

/**
 * LIVE 15-minute intraday closes for a set of symbols. The stored per-symbol series only rebuilds
 * after the close, so charts on the 1D/1W tenors would otherwise show the prior session; this
 * fetches fresh bars on demand. Throttled + retried so a big sub-industry (up to ~250 names) can
 * be covered in full without hammering Yahoo, and cached briefly. Returns { series: { SYM: [[t,c], …] } }.
 */
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DAY = 86_400_000;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let gate: Promise<void> = Promise.resolve();
const throttle = (gap = 100): Promise<void> => { const p = gate.then(() => sleep(gap)); gate = p; return p; };

// One retry (re-gated) so the faster cadence stays robust: a transient throttle/blip drops a name
// to its static series otherwise, which on a many-name chart reads as one stale line in the bunch.
async function intradayOf(symbol: string, interval: string, days: number, tries = 2): Promise<XY[]> {
  await throttle();
  try {
    const ch: any = await yf.chart(symbol, { period1: new Date(Date.now() - days * DAY), interval, includePrePost: false } as any, { validateResult: false });
    const xy = (ch.quotes || []).filter((q: any) => q?.date && q.close != null).map((q: any) => [new Date(q.date).getTime(), q.close] as XY);
    if (!xy.length && tries > 1) return intradayOf(symbol, interval, days, tries - 1);
    return xy;
  } catch {
    if (tries > 1) return intradayOf(symbol, interval, days, tries - 1);
    return [];
  }
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
  const symbols = [...new Set((req.nextUrl.searchParams.get("symbols") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 300);
  if (!symbols.length) return NextResponse.json({ series: {} });
  // 1D requests fine (5-minute) bars over ~2 days for a smoother, fresher line; 1W keeps 15-minute
  // over 8 days. Fine fetches cache briefly so the ~40s poll picks up the in-progress bar promptly.
  const fine = req.nextUrl.searchParams.get("interval") === "5m";
  const interval = fine ? "5m" : "15m", days = fine ? 2 : 8;
  const fetched = await mapPool(symbols, 10, (s) => intradayOf(s, interval, days));
  const series: Record<string, XY[]> = {};
  symbols.forEach((s, i) => { series[s] = fetched[i] || []; });
  const cache = fine ? "public, s-maxage=30, stale-while-revalidate=60" : "public, s-maxage=120, stale-while-revalidate=300";
  return NextResponse.json({ series }, { headers: { "Cache-Control": cache } });
}
