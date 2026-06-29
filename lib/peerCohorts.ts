// Curated peer cohorts for the cases where GICS sub-industry misses business-relevant comps.
// GICS files athletic-footwear names (DECK = Hoka/Ugg, ONON = On) under "Footwear" while
// athleisure (LULU) sits in "Apparel" and accessible luxury (TPR, RL) in "Apparel & Luxury" — but
// they all compete for the same wallet, so an analyst comps them together. When a ticker is in a
// cohort the comp uses the cohort instead of the GICS group. Extend freely.

export interface Cohort {
  label: string;
  tickers: string[];
}

export const PEER_COHORTS: Cohort[] = [
  { label: "Apparel, footwear & athleisure", tickers: ["NKE", "LULU", "DECK", "ONON", "ADDYY", "SKX", "CROX", "BIRK", "UAA", "UA", "VFC", "COLM", "TPR", "RL", "CPRI", "PVH", "LEVI", "GES", "RVLV", "BOOT", "GIII"] },
  { label: "Mega-cap tech & internet", tickers: ["AAPL", "MSFT", "GOOGL", "GOOG", "AMZN", "META", "NVDA"] },
  { label: "Payments & card networks", tickers: ["V", "MA", "AXP", "PYPL", "FI", "FIS", "GPN", "DFS", "COF", "SQ", "XYZ"] },
  { label: "Streaming & media", tickers: ["NFLX", "DIS", "WBD", "PARA", "CMCSA", "FOXA", "FOX", "ROKU"] },
  { label: "Autos & EV", tickers: ["TSLA", "GM", "F", "RIVN", "LCID", "STLA", "TM", "HMC", "NIO", "LI", "XPEV"] },
  { label: "Ride-share, delivery & travel platforms", tickers: ["UBER", "LYFT", "DASH", "ABNB", "BKNG", "EXPE"] },
  { label: "Cloud software & data", tickers: ["CRM", "NOW", "SNOW", "DDOG", "MDB", "WDAY", "TEAM", "ORCL", "ADBE", "PLTR"] },
  { label: "Semiconductors", tickers: ["NVDA", "AMD", "AVGO", "QCOM", "INTC", "MU", "TXN", "ARM", "TSM", "MRVL", "ADI", "NXPI"] },
  { label: "Big-box & e-commerce retail", tickers: ["WMT", "TGT", "COST", "AMZN", "DLTR", "DG", "BJ", "KR"] },
  { label: "Home improvement & hardlines", tickers: ["HD", "LOW", "FND", "WSM", "RH", "TSCO", "BBY"] },
];

const BY_TICKER = new Map<string, Cohort>();
for (const c of PEER_COHORTS) for (const t of c.tickers) if (!BY_TICKER.has(t)) BY_TICKER.set(t, c);

/** The curated cohort a ticker belongs to, or null (then fall back to GICS grouping). */
export function peerCohort(symbol: string): Cohort | null {
  return BY_TICKER.get(symbol.trim().toUpperCase()) ?? null;
}
