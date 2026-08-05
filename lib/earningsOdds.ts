/**
 * Earnings odds — the shapes + pure logic behind /earnings-odds (the funda-gap #1 build).
 *
 * The board crosses three independent reads on the same print:
 *   1. Polymarket's P(beat) — a real-money crowd probability, per name;
 *   2. the options market's implied ±move (from the earnings-move feed);
 *   3. the desk's own predicted print (from the earnings-preview log).
 *
 * THE LOAD-BEARING COLUMN IS NOT THE ODDS. Polymarket freezes the EPS strike in the market slug at
 * creation ("…-eps-08-12-2026-1pt27" = beat $1.27), while street consensus keeps drifting — so
 * `epsAvg − strike` is a mechanical, code-computed staleness the crowd may or may not have repriced.
 * A market asking "beat $1.27?" when consensus has climbed to $1.40 has a LOW bar: its YES should be
 * rich, and if it isn't, one of the two crowds is wrong.
 *
 * ⚠ BASIS: the strike is explicitly GAAP or NON-GAAP (it's in the slug). Street consensus (Yahoo's
 * earningsTrend avg) is the ADJUSTED number, so the drift column exists ONLY for nongaap markets —
 * comparing a GAAP strike to non-GAAP consensus would manufacture fake drift. GAAP rows keep their
 * odds and lose the drift, with the basis printed so the absence reads as honesty, not a bug.
 *
 * This file is pure (no fs, no fetch) so the parser and the drift rule are unit-testable; the
 * nightly fetch/join lives in scripts/refresh-earnings-odds.ts.
 */

export interface EarningsOddsRow {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  marketCap: number | null;
  /** Bare YYYY-MM-DD calendar day from the market slug — a calendar square, not an instant. */
  reportDate: string;
  basis: "gaap" | "nongaap";
  /** The EPS bar frozen into the market at creation. */
  strikeEps: number;
  /** Street consensus for the quarter (Yahoo earningsTrend 0q avg), null when unavailable. */
  epsAvg: number | null;
  epsAnalysts: number | null;
  /** Consensus 30 days ago — how the street has been moving while the strike stood still. */
  epsAvg30dAgo: number | null;
  /** epsAvg − strikeEps, nongaap markets only (see BASIS above). Positive = the bar is BELOW today's
   *  consensus, i.e. an easier beat than the headline question suggests. */
  driftEps: number | null;
  /** P(beat) — mid of best bid/ask when both sides are quoted, else the venue's last price mark. */
  pBeat: number | null;
  /** Bid/ask spread in probability points; wide = the odds are decoration, not information. */
  spread: number | null;
  /** True when spread > SPREAD_SUPPRESS — the UI shows the row but refuses to print pBeat. */
  thin: boolean;
  volumeUsd: number | null;
  liquidityUsd: number | null;
  polymarketSlug: string;
  /** From the earnings-move feed (≤16d reporters only). */
  impliedMovePct: number | null;
  richness: number | null;
  /** From the earnings-preview log (the desk's model, logged before the print). */
  predEps: number | null;
  predCall: string | null; // "beat" | "miss" | "inline"
  predConfidence: string | null;
}

export interface EarningsOddsFile {
  generatedAt: string;
  /** Open, forward-dated markets after all joins. Empty out of season — the page must say so. */
  rows: EarningsOddsRow[];
  /** Honesty counters: how much of what Polymarket lists we could actually use. */
  scanned: number; // open events on the venue
  offUniverse: number; // ticker not in our broadest snapshot
  pastDated: number; // slug date already passed (resolution stragglers)
}

/** Suppress the odds column above this bid/ask spread (probability points). The venue's median
 *  earnings-market book is a few thousand dollars; past ~10c the "price" is two market-makers waving. */
export const SPREAD_SUPPRESS = 0.10;

const SLUG_RE = /^(.+?)-quarterly-earnings-(gaap|nongaap)-eps-(\d{2})-(\d{2})-(\d{4})-(neg)?(\d+)(?:pt(\d+))?$/;

export interface ParsedSlug {
  ticker: string;
  basis: "gaap" | "nongaap";
  reportDate: string; // YYYY-MM-DD calendar square
  strikeEps: number;
}

/**
 * Parse a Polymarket earnings slug: `{ticker}-quarterly-earnings-{basis}-eps-{MM}-{DD}-{YYYY}-{strike}`
 * with `neg` marking a negative strike and `pt` the decimal point ("neg0pt02" → −0.02, "1pt27" → 1.27,
 * "2" → 2). Ticker keeps internal hyphens uppercased ("brk-b" → "BRK-B", matching this repo's Yahoo
 * spelling). Returns null on anything that doesn't match — an unparseable slug is a skipped market,
 * never a guessed one.
 */
export function parseEarningsSlug(slug: string): ParsedSlug | null {
  const m = SLUG_RE.exec(slug);
  if (!m) return null;
  const [, rawTicker, basis, mm, dd, yyyy, neg, int, dec] = m;
  const mag = Number(`${int}.${dec ?? "0"}`);
  if (!Number.isFinite(mag)) return null;
  return {
    ticker: rawTicker.toUpperCase(),
    basis: basis as "gaap" | "nongaap",
    reportDate: `${yyyy}-${mm}-${dd}`,
    strikeEps: (neg ? -1 : 1) * mag,
  };
}

/** Consensus-vs-frozen-strike drift — nongaap only; see the BASIS note in the header. */
export function driftEps(basis: "gaap" | "nongaap", strikeEps: number, epsAvg: number | null): number | null {
  if (basis !== "nongaap" || epsAvg == null) return null;
  return +(epsAvg - strikeEps).toFixed(4);
}

/**
 * P(beat) from the market's quotes: the mid when both sides exist (the only number that means
 * anything on a thin book), else the venue's outcome mark. Clamped to [0,1].
 */
export function pBeatFrom(bestBid: number | null, bestAsk: number | null, yesMark: number | null): number | null {
  const p =
    bestBid != null && bestAsk != null && bestBid > 0 && bestAsk > 0 && bestAsk <= 1
      ? (bestBid + bestAsk) / 2
      : yesMark;
  if (p == null || !Number.isFinite(p)) return null;
  // 3dp: a prediction-market mid carries no information past a tenth of a percent, and un-rounded
  // float midpoints ((0.85+0.95)/2 = 0.8999…) would churn the nightly diff for nothing.
  return +Math.min(1, Math.max(0, p)).toFixed(3);
}
