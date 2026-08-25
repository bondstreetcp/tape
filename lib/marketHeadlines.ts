/**
 * "Market headlines" wire — the general macro / market / geopolitical flashes that the company-news tape
 * (EDGAR + press wires) and the BEA/BLS release feed don't carry: Fed-speaker comments, tariffs/trade,
 * OPEC/oil, rates, central banks, China/geopolitics. Free & keyless, off Google News RSS topic searches.
 *
 * This is the closest free stand-in for the NON-company slice of a paid headline wire (what @DeltaOne
 * relays beyond the gov data). It is NOT sub-second and carries no human curation — it's a ~10-min-lagged
 * aggregate. Populated by scripts/refresh-market-headlines.ts → data/market-headlines.json.
 *
 * CLIENT-SAFE: imported by MacroDashboard / MarketHeadlinesWire (client) for the types + TOPIC_COLOR, so
 * no node builtins here. The fs reader + the live fetch live in lib/marketHeadlinesFetch.ts (server-only).
 */
export type HeadlineTopic = "Markets" | "Fed" | "Rates" | "Trade" | "Energy" | "Global";

export interface MarketHeadline {
  title: string;
  publisher: string;
  url: string;
  time: string | null; // ISO
  topic: HeadlineTopic;
  curated?: boolean; // true = a hand-curated flash (Walter Bloomberg's public Telegram), not an aggregator hit
  ticker?: string | null; // a cashtag parsed from the headline ($AAPL → "AAPL"), for a jump-to-stock link
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
