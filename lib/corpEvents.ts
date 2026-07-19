/**
 * Corporate Events — the KEDM-style monitor rack for one-off catalysts pulled from SEC 8-Ks:
 * buybacks, strategic-alternatives (potential sale), spin-offs, stock splits, and leadership (CEO/CFO)
 * changes. GLM extracts the specifics + drops routine filings. Built by scripts/refresh-corp-events.ts.
 * A public-disclosure tracker, not advice.
 */

export type CorpEventType = "buyback" | "strategic-alt" | "spin-off" | "split" | "leadership";

export interface CorpEvent {
  id: string; // accession
  date: string; // ISO filing date
  type: CorpEventType;
  ticker: string | null;
  company: string;
  headline: string; // one-line LLM detail (size/% for buybacks, ratio for splits, who for leadership)
  url: string;
  sincePct: number | null; // stock return since the filing
}

export interface CorpEventsData {
  generatedAt: string;
  scanned: number;
  events: CorpEvent[]; // newest first
}

// ── helpers for the trade-log catalyst overlay (pure — tested in tests/corpEvents.test.ts) ──────

// A RESOLVED catalyst (completed spin, concluded review, signed definitive deal) is no longer a reason
// vol should be elevated into a print, so the overlay drops tickers whose most recent event reads as
// resolved. VERB-anchored deliberately: "on track for completion July 6" (a spin still LIVE) must NOT
// match, while "completed/completes the spin-off" and "concludes its strategic review" must.
const RESOLVED_RE = /\b(complet(?:ed|es)|conclud(?:ed|es)|finaliz(?:ed|es)|terminat(?:ed|es)|definitive\s+(?:merger\s+)?agreement|to\s+be\s+acquired)\b/i;
export const eventResolved = (headline: string): boolean => RESOLVED_RE.test(headline);

/** Share-class root: BRK-B / BF.A → BRK / BF. EDGAR display names store the FIRST-listed class while
 *  snapshots carry the traded one (BF-A filed vs BF-B traded), so the overlay joins on the root as a
 *  fallback. Non-class symbols pass through unchanged. */
export const classRoot = (sym: string): string => sym.toUpperCase().replace(/\./g, "-").replace(/-[A-Z]$/, "");

export const typeColor = (t: CorpEventType): string =>
  t === "buyback" ? "#22c55e" : t === "strategic-alt" ? "#f59e0b" : t === "spin-off" ? "#a78bfa" : t === "split" ? "#60a5fa" : "#f472b6";
export const typeLabel = (t: CorpEventType): string =>
  t === "buyback" ? "Buyback" : t === "strategic-alt" ? "Strategic alternatives" : t === "spin-off" ? "Spin-off" : t === "split" ? "Stock split" : "Leadership change";
export const perfColor = (v: number | null | undefined): string => (v == null ? "var(--text-4)" : v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "var(--text-2)");
