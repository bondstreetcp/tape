/**
 * Reddit "buzz" per ticker — mention counts + 24h change from ApeWisdom (apewisdom.io), which
 * aggregates r/wallstreetbets, r/stocks, r/investing, etc. This is ATTENTION/buzz, NOT sentiment:
 * a high or fast-rising mention count says the crowd is talking, not whether they're bullish.
 *
 * Only the ~800 most-mentioned tickers are covered — most names won't appear (no buzz), which is the
 * signal. Free, no key. Refreshed nightly (scripts/refresh-apewisdom.ts). Client-safe types + loader.
 */
export interface ApeWisdomEntry {
  name: string; // ApeWisdom's company name
  rank: number; // 1 = most-mentioned across Reddit right now
  mentions: number; // mentions in the trailing 24h window
  upvotes: number;
  mentions24hAgo: number;
  rank24hAgo: number;
  mentionChangePct: number | null; // (mentions − mentions24hAgo) / mentions24hAgo × 100
  rankChange: number | null; // rank24hAgo − rank (positive = climbing the board)
}

export interface ApeWisdomData {
  generatedAt: string;
  byTicker: Record<string, ApeWisdomEntry>;
}

/** A row for the cross-universe Reddit-buzz board. */
export interface BuzzRow extends ApeWisdomEntry {
  ticker: string;
  sector?: string;
}

/** Decode HTML entities ApeWisdom leaves in names (S&amp;P, Wendy’s already decoded by JSON). */
const fixName = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;|&rsquo;/g, "’");

/** All buzz tickers as rows (sector enriched from a snapshot where available), ranked by mentions. */
export function buildBuzzRows(data: ApeWisdomData, sectorOf: (t: string) => string | undefined): BuzzRow[] {
  return Object.entries(data.byTicker)
    .map(([ticker, e]) => ({ ...e, ticker, name: fixName(e.name || ticker), sector: sectorOf(ticker) }))
    .sort((a, b) => a.rank - b.rank);
}
