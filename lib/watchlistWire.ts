/**
 * Watchlist news wire — pure types + shaping for the Daily Desk's "your names" feed (2026-08,
 * Sam: "curate the news headlines to my watchlist"). The server route joins, per watched name:
 * the freshest dated headlines (pickHeadlines doctrine — junk-filtered, recency-windowed), the
 * CODE-ANCHORED "reported" fact (a results 8-K on record — lib/preannounce.detectRecentReport,
 * the same fact that fixed the desk brief's ABNB/RMD/AKAM attribution), the live catalyst flag
 * (acquisition / strategic-alt / spin-off), and the 1-day move. This module stays pure (no
 * fs/fetch) so ordering is unit-testable and the client can import the types.
 */

export interface WireHeadline {
  title: string;
  date: string; // YYYY-MM-DD, "" when the vendor gave no date
  publisher: string;
  link: string | null;
}

export interface WireName {
  symbol: string;
  name: string | null;
  pct1d: number | null;
  /** results 8-K on record within the last week — the print IS the context for this name's tape */
  reported: { date: string; daysAgo: number } | null;
  catalyst: { kind: string; headline: string; date: string } | null;
  headlines: WireHeadline[];
}

export interface WatchlistWireData {
  generatedAt: string;
  names: WireName[];
}

/**
 * Reading order for the wire — the morning scan, most-actionable first:
 * 1. Names that REPORTED, freshest print first (today's print outranks Tuesday's);
 * 2. then by |1-day move| (the tape's own priority);
 * 3. names with headlines before silent ones; alphabetical last so the order is stable.
 */
export function orderWire(rows: WireName[]): WireName[] {
  return [...rows].sort((a, b) => {
    const ra = a.reported ? a.reported.daysAgo : Infinity;
    const rb = b.reported ? b.reported.daysAgo : Infinity;
    if (ra !== rb) return ra - rb;
    const ma = a.pct1d != null ? Math.abs(a.pct1d) : -1;
    const mb = b.pct1d != null ? Math.abs(b.pct1d) : -1;
    if (ma !== mb) return mb - ma;
    const ha = a.headlines.length ? 1 : 0;
    const hb = b.headlines.length ? 1 : 0;
    if (ha !== hb) return hb - ha;
    return a.symbol.localeCompare(b.symbol);
  });
}

/** Normalize + bound the client-supplied symbol list: uppercase, dedupe, cap. */
export function normalizeSyms(raw: string, cap = 40): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const s = part.trim().toUpperCase();
    if (s && /^[A-Z0-9.\-]{1,10}$/.test(s)) seen.add(s);
    if (seen.size >= cap) break;
  }
  return [...seen];
}
