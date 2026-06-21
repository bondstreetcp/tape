/**
 * Canonical shape for an ingested sell-side research document, designed from real
 * broker reports (RBC / TD / Citi / Stifel rating notes + Bloomberg Intelligence
 * research). The `estimates` rows are the cross-broker comparison layer — they
 * normalise each report's forward numbers so consensus, revisions and outliers can
 * be computed across the corpus.
 */

export type DocType =
  | "rating-change"
  | "initiation"
  | "preview"
  | "earnings-review"
  | "event-reaction"
  | "industry-research"
  | "note"
  | "other";

export interface ResearchEstimate {
  metric: string;        // "EPS" | "Revenue" | "Gross margin" | "ASP" | "Price target" | ...
  period: string;        // "F3Q26" | "FY26" | "FY27" | "CY27" | "1d" ...
  value: number | null;  // numeric estimate (e.g. 159 for $159 EPS, 254.47 for $254.47B revenue)
  unit?: string | null;  // "$/sh" | "$B" | "%" | null
  priorValue: number | null;   // the prior estimate when a revision is shown
  vsConsensus: string | null;  // how it compares to Street if stated ("4% above Street")
}

export interface ResearchDoc {
  ticker: string;        // primary subject, e.g. "MU"
  company: string;       // "Micron Technology"
  source: string;        // publishing firm — "RBC Capital", "TD Securities", "Citi", "Stifel", "Bloomberg Intelligence"
  analysts: string[];    // ["Krish Sankar"]
  publishDate: string;   // ISO date "2026-06-14"
  docType: DocType;
  title: string;

  rating: string | null;        // "Buy" | "Outperform" | "Hold" | "Sell" | null (research providers)
  ratingPrior: string | null;
  priceTarget: number | null;   // new 12-month target
  priceTargetPrior: number | null;
  targetBasis: string | null;   // "~10x CY27E EPS"

  thesis: string[];      // 3–5 concise bullets
  risks: string[];
  catalysts: string[];   // what-to-watch / upcoming events

  estimates: ResearchEstimate[];
  summary: string;       // tight buy-side memo

  /** Any "exclusive use of <name/firm>" watermark — a redistribution guardrail. Null if none. */
  entitlement: string | null;
}

/** A stored document = the extracted fields + provenance + the full report text used to
 *  ground LLM search. `text` is server-side only — it is stripped before the doc list is
 *  sent to the client (it's large, and the prose is licensed). */
export interface StoredDoc extends ResearchDoc {
  id: string;            // content hash of the source file
  fileName: string;
  pageCount: number;
  charCount: number;
  ingestedAt: string;    // ISO
  blobKey: string | null; // where the raw PDF lives (object store key) — null in metadata-only mode
  text?: string;         // full extracted report text (grounds full-text LLM search)
}

export interface DocChunk {
  docId: string;
  ordinal: number;
  text: string;
  embedding: number[];   // vector for semantic search / RAG
}
