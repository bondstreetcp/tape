// Congress-trading SUMMARY — an LLM pass over the members' disclosed trades that pulls out what's
// notable or potentially actionable (cluster buying, unusually large trades, concentrated sector
// bets, notable members' conviction) vs. the routine noise (index funds, tiny housekeeping trades,
// liquidity sells). Shown as a banner atop the Congress page. Client-safe (type only).

export interface CongressHighlight {
  headline: string; // the notable item, scannable
  detail: string; // the read — why it's worth noting
  tag: string; // Cluster buy | Large trade | Notable member | Sector bet | Sells | Watch
  tickers: string[];
}

export interface CongressSummary {
  generatedAt: string;
  since: string | null;
  tldr: string; // the one-paragraph read on the period's flow
  highlights: CongressHighlight[];
}
