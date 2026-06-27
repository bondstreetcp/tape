/**
 * Overnight Filings (SuperAnalyst) — AI desk notes on new material SEC filings,
 * each summarized vs the PRIOR comparable filing of the same type. The heavy
 * lifting (EDGAR detection + LLM extraction) happens offline in
 * scripts/refresh-overnight-filings.ts → data/overnight-filings.json; this module
 * owns the types + the cached loader (mirrors lib/congress.ts).
 *
 * AI-generated from the supplied filing text — spot-check claims against the source.
 */
import { promises as fsp } from "fs";
import path from "path";

export type Sentiment = "bullish" | "neutral" | "bearish";
export type Surprise = "beat" | "inline" | "miss" | "na";

/** The model's per-filing digest (see the SYSTEM/SCHEMA in the refresh script). */
export interface OvernightDigest {
  headline: string;
  whatChanged: string[];
  decisionTakeaway: string;
  sentiment: Sentiment;
  surprise: Surprise;
  keyMetrics: Record<string, unknown>;
}

export interface OvernightItem extends OvernightDigest {
  ticker: string;
  name: string;
  form: string; // 8-K, 10-Q, 10-K (or an /A amendment)
  filedAt: string; // EDGAR acceptanceDateTime (ET)
  riskFactorsAdded: number | null; // 10-K/Q only — machine-diffed risk-factor delta
  riskFactorsRemoved: number | null;
  accession: string;
  url: string; // EDGAR filing-index page for this accession
}

export interface OvernightData {
  generatedAt: string;
  windowHours: number;
  since: string; // ISO — start of the detection window
  count: number;
  items: OvernightItem[]; // newest filing first
}

let _cache: Promise<OvernightData | null> | null = null;

export function loadOvernightFilings(): Promise<OvernightData | null> {
  if (!_cache)
    _cache = fsp
      .readFile(path.join(process.cwd(), "data", "overnight-filings.json"), "utf8")
      .then((s) => JSON.parse(s) as OvernightData)
      .catch(() => null);
  return _cache;
}
