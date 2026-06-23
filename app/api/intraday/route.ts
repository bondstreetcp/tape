import { NextRequest, NextResponse } from "next/server";
import YahooFinance from "yahoo-finance2";
import type { XY } from "@/lib/types";

/**
 * LIVE 15-minute intraday closes for a set of symbols. The stored per-symbol series only rebuilds
 * after the close, so charts on the 1D/1W tenors would otherwise show the prior session; this
 * fetches fresh bars on demand. Capped + throttled so a busy sub-industry doesn't hammer Yahoo,
 * and cached briefly. Returns { series: { SYM: [[t,c], …] } }.
 */
const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DAY = 86_400_000;

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let gate: Promise<void> = Promise.resolve();
const throttle = (gap = 180): Promise<void> => { const p = gate.then(() => sleep(gap)); gate = p; return p; };

async function intradayOf(symbol: string): Promise<XY[]> {
  await throttle();
  try {
    const ch: any = await yf.chart(symbol, { period1: new Date(Date.now() - 8 * DAY), interval: "15m", includePrePost: false } as any, { validateResult: false });
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
  const symbols = [...new Set((req.nextUrl.searchParams.get("symbols") || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean))].slice(0, 80);
  if (!symbols.length) return NextResponse.json({ series: {} });
  const fetched = await mapPool(symbols, 8, intradayOf);
  const series: Record<string, XY[]> = {};
  symbols.forEach((s, i) => { series[s] = fetched[i] || []; });
  return NextResponse.json({ series }, { headers: { "Cache-Control": "public, s-maxage=120, stale-while-revalidate=300" } });
}
