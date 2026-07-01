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

export const typeColor = (t: CorpEventType): string =>
  t === "buyback" ? "#22c55e" : t === "strategic-alt" ? "#f59e0b" : t === "spin-off" ? "#a78bfa" : t === "split" ? "#60a5fa" : "#f472b6";
export const typeLabel = (t: CorpEventType): string =>
  t === "buyback" ? "Buyback" : t === "strategic-alt" ? "Strategic alternatives" : t === "spin-off" ? "Spin-off" : t === "split" ? "Stock split" : "Leadership change";
export const perfColor = (v: number | null | undefined): string => (v == null ? "var(--text-4)" : v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "var(--text-2)");
