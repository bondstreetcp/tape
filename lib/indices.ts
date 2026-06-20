// Metadata for the index profile pages (/u/[universe]/index/[symbol]). `universe`
// links to a full constituent heatmap we already have; `constituents` (+ optional
// constituentUniverse to source their data) renders an inline heatmap for indices
// without their own universe (e.g. the Dow 30, whose members live in the US snapshots).
export interface IndexMeta {
  symbol: string;
  name: string;
  about: string;
  universe?: string;
  constituents?: string[];
  constituentUniverse?: string;
}

// Current Dow Jones Industrial Average components.
const DOW30 = [
  "AAPL", "AMZN", "AMGN", "AXP", "BA", "CAT", "CRM", "CSCO", "CVX", "DIS",
  "GS", "HD", "HON", "IBM", "JNJ", "JPM", "KO", "MCD", "MMM", "MRK",
  "MSFT", "NKE", "NVDA", "PG", "SHW", "TRV", "UNH", "V", "VZ", "WMT",
];

export const INDEX_META: Record<string, IndexMeta> = {
  "^DJI": { symbol: "^DJI", name: "Dow Jones Industrial Average (Dow 30)", about: "30 large, well-established U.S. blue-chip companies. The Dow is price-weighted (higher-priced stocks have more influence) rather than market-cap weighted, and is the oldest continuously-tracked U.S. equity index.", constituents: DOW30, constituentUniverse: "sp1500" },
  "^GSPC": { symbol: "^GSPC", name: "S&P 500", about: "500 of the largest U.S. companies, market-cap weighted — the standard benchmark for U.S. large-cap equities.", universe: "sp500" },
  "^IXIC": { symbol: "^IXIC", name: "Nasdaq Composite", about: "All ~3,000 common stocks listed on the Nasdaq exchange — heavily weighted toward technology.", universe: "nasdaq100" },
  "^RUT": { symbol: "^RUT", name: "Russell 2000", about: "2,000 small-cap U.S. companies — the most-watched gauge of U.S. small-cap performance.", universe: "russell3000" },
  "^VIX": { symbol: "^VIX", name: "CBOE Volatility Index (VIX)", about: "The market's expectation of 30-day forward volatility of the S&P 500, derived from option prices — the 'fear gauge'. It rises when markets fall." },
  "RSP": { symbol: "RSP", name: "S&P 500 Equal Weight", about: "The S&P 500 with every constituent weighted equally rather than by market cap — less concentrated in mega-caps, more exposed to the average stock." },
  "^FTSE": { symbol: "^FTSE", name: "FTSE 100", about: "The 100 largest companies on the London Stock Exchange.", universe: "ftse100" },
  "^GDAXI": { symbol: "^GDAXI", name: "DAX", about: "The 40 largest German companies on the Frankfurt exchange.", universe: "dax" },
  "^FCHI": { symbol: "^FCHI", name: "CAC 40", about: "The 40 largest companies on Euronext Paris.", universe: "cac40" },
  "^AEX": { symbol: "^AEX", name: "AEX", about: "The leading companies on Euronext Amsterdam.", universe: "aex" },
  "^STOXX50E": { symbol: "^STOXX50E", name: "Euro Stoxx 50", about: "50 blue-chip companies across the eurozone — the leading pan-European large-cap index." },
  "^N225": { symbol: "^N225", name: "Nikkei 225", about: "225 large Japanese companies on the Tokyo Stock Exchange, price-weighted.", universe: "nikkei" },
  "^KS11": { symbol: "^KS11", name: "KOSPI", about: "The benchmark index of all common stocks on the Korea Exchange.", universe: "kospi" },
  "^GSPTSE": { symbol: "^GSPTSE", name: "S&P/TSX Composite", about: "The headline index of the Toronto Stock Exchange — ~225 Canadian companies.", universe: "tsx" },
};
