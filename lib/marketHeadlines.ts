/**
 * "Market headlines" wire — the general macro / market / geopolitical flashes that the company-news tape
 * (EDGAR + press wires) and the BEA/BLS release feed don't carry: Fed-speaker comments, tariffs/trade,
 * OPEC/oil, rates, central banks, China/geopolitics. Free & keyless, off Google News RSS topic searches.
 *
 * This is the closest free stand-in for the NON-company slice of a paid headline wire (what @DeltaOne
 * relays beyond the gov data). It is NOT sub-second and carries no human curation — it's a ~10-min-lagged
 * aggregate. Populated by scripts/refresh-market-headlines.ts → data/market-headlines.json.
 */
import { promises as fsp } from "fs";
import path from "path";

export type HeadlineTopic = "Markets" | "Fed" | "Rates" | "Trade" | "Energy" | "Global";

export interface MarketHeadline {
  title: string;
  publisher: string;
  url: string;
  time: string | null; // ISO
  topic: HeadlineTopic;
}

export interface MarketHeadlinesData {
  generatedAt: string;
  headlines: MarketHeadline[]; // newest first
}

export const TOPIC_COLOR: Record<HeadlineTopic, string> = {
  Markets: "#3b82f6",
  Fed: "#ef4444",
  Rates: "#a855f7",
  Trade: "#f59e0b",
  Energy: "#22c55e",
  Global: "#8b93a7",
};

/** Read the committed wire for the UI. Empty (never throws) until the feed has run. */
export async function getMarketHeadlines(limit = 30): Promise<MarketHeadline[]> {
  try {
    const raw = await fsp.readFile(path.join(process.cwd(), "data", "market-headlines.json"), "utf8");
    const d = JSON.parse(raw) as MarketHeadlinesData;
    return (d.headlines ?? [])
      .filter((h) => h && h.title && h.url)
      .sort((a, b) => (Date.parse(b.time || "") || 0) - (Date.parse(a.time || "") || 0))
      .slice(0, limit);
  } catch {
    return [];
  }
}
