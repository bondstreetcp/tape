/**
 * "Trump stock calls" — the curated feed of ONLY the Truth Social posts where the President names a
 * publicly-traded company (DELL, INTC, …), with how the stock has done since. Filters out all the
 * political noise. Built offline by scripts/refresh-trump-truth.ts → data/trump-truth-stocks.json.
 *
 * CLIENT-SAFE: types + pure helpers only (no fs). The page reads the JSON server-side.
 * This is a public-post MENTION/stance tracker, not investment advice.
 */

export type Stance = "bullish" | "bearish" | "neutral";

export interface Perf {
  priceAtPost: number | null; // close on/after the post date
  priceNow: number | null;
  sincePct: number | null; // return from the post to now
  d1Pct: number | null; // ~1 trading day after
  w1Pct: number | null; // ~1 week after
  m1Pct: number | null; // ~1 month after
}

export interface TickerCall {
  ticker: string;
  company: string;
  stance: Stance;
  perf?: Perf | null;
}

export interface TrumpStockPost {
  id: string;
  date: string; // ISO post datetime
  url: string; // link to the Truth Social post
  excerpt: string; // short quote of the relevant bit
  rationale: string; // one-line: what he said / why it's stock-relevant
  tickers: TickerCall[];
}

export interface TrumpStocksData {
  generatedAt: string;
  source: string;
  scanned: number; // posts scanned in the window
  posts: TrumpStockPost[]; // stock-relevant only, newest first
}

export const stanceColor = (s: Stance): string => (s === "bullish" ? "#22c55e" : s === "bearish" ? "#ef4444" : "var(--text-2)");
export const perfColor = (v: number | null | undefined): string => (v == null ? "var(--text-4)" : v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "var(--text-2)");

export interface TrumpStockStats {
  nPosts: number;
  nCalls: number; // ticker-mentions across posts
  bullN: number; // bullish calls with a measurable return
  bullUp: number; // of those, how many are up since
  bullHitRate: number | null; // bullUp / bullN
  avgBullSince: number | null; // mean since-return across bullish calls
}

// Scorecard: of his BULLISH mentions, how often is the stock up since — the "do his picks work" read.
export function summarize(posts: TrumpStockPost[]): TrumpStockStats {
  const calls = posts.flatMap((p) => p.tickers);
  const bull = calls.filter((c) => c.stance === "bullish" && c.perf?.sincePct != null);
  const bullUp = bull.filter((c) => (c.perf!.sincePct as number) > 0).length;
  return {
    nPosts: posts.length,
    nCalls: calls.length,
    bullN: bull.length,
    bullUp,
    bullHitRate: bull.length ? bullUp / bull.length : null,
    avgBullSince: bull.length ? bull.reduce((a, c) => a + (c.perf!.sincePct as number), 0) / bull.length : null,
  };
}
