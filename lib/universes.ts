// Selectable index universes. Each is a distinct constituent list; the app's
// data and routes are scoped by universe id.
export interface UniverseMeta {
  id: string;
  name: string; // full display name
  short: string; // compact label for the switcher
  /** Whether we fetch per-stock intraday data (enables 1D/1W comparison lines). */
  intraday: boolean;
  note?: string;
  /** International index: the home page shows the index chart + a constituent
   *  heatmap instead of US-GICS sector buckets. */
  international?: boolean;
  indexSymbol?: string; // Yahoo symbol for the headline index (for the chart)
}

export const UNIVERSES: UniverseMeta[] = [
  { id: "sp500", name: "S&P 500", short: "S&P 500", intraday: true },
  { id: "nasdaq100", name: "Nasdaq 100", short: "Nasdaq 100", intraday: true },
  {
    id: "russell1000",
    name: "Russell 1000",
    short: "Russell 1000",
    intraday: false,
  },
  {
    id: "sp1500",
    name: "Broad 1500 (S&P 1500)",
    short: "Broad 1500",
    intraday: false,
    note: "S&P 500 + 400 + 600 — a broad large/mid/small-cap universe.",
  },
  {
    id: "russell3000",
    name: "Russell 3000",
    short: "Russell 3000",
    intraday: false,
    note: "The full Russell 3000 (~2,900 names), sourced from the iShares IWV holdings file — the broadest U.S. equity universe here.",
  },
  {
    id: "cac40",
    name: "CAC 40 (France)",
    short: "CAC 40",
    intraday: false,
    international: true,
    indexSymbol: "^FCHI",
    note: "France's CAC 40 — Euronext Paris. Prices in EUR. International data via Yahoo (npm run refresh-intl).",
  },
  {
    id: "aex",
    name: "AEX (Netherlands)",
    short: "AEX",
    intraday: false,
    international: true,
    indexSymbol: "^AEX",
    note: "The Amsterdam AEX index — Euronext Amsterdam. Prices in EUR. International data via Yahoo (npm run refresh-intl).",
  },
  {
    id: "kospi",
    name: "KOSPI (Korea)",
    short: "KOSPI",
    intraday: false,
    international: true,
    indexSymbol: "^KS11",
    note: "Major KOSPI constituents — Korea Exchange. Prices in KRW. International data via Yahoo (npm run refresh-intl).",
  },
  {
    id: "nikkei",
    name: "Nikkei 225 (Japan)",
    short: "Nikkei",
    intraday: false,
    international: true,
    indexSymbol: "^N225",
    note: "Major Nikkei 225 constituents — Tokyo Stock Exchange. Prices in JPY. International data via Yahoo (npm run refresh-intl).",
  },
  {
    id: "ftse100",
    name: "FTSE 100 (UK)",
    short: "FTSE 100",
    intraday: false,
    international: true,
    indexSymbol: "^FTSE",
    note: "Major FTSE 100 constituents — London Stock Exchange. Prices in GBp. International data via Yahoo (npm run refresh-intl).",
  },
  {
    id: "dax",
    name: "DAX (Germany)",
    short: "DAX",
    intraday: false,
    international: true,
    indexSymbol: "^GDAXI",
    note: "Major DAX constituents — Deutsche Börse. Prices in EUR. International data via Yahoo (npm run refresh-intl).",
  },
];

export const DEFAULT_UNIVERSE = "sp500";
export const UNIVERSE_IDS = UNIVERSES.map((u) => u.id);
export const UNIVERSE_BY_ID: Record<string, UniverseMeta> = Object.fromEntries(
  UNIVERSES.map((u) => [u.id, u]),
);
