// The 11 GICS sectors and their SPDR Select Sector ETF proxies.

export interface SectorMeta {
  etf: string; // SPDR sector ETF ticker
  name: string; // short display name
  gics: string; // exact GICS sector label used by the constituents list
}

export const SECTORS: SectorMeta[] = [
  { etf: "XLK", name: "Technology", gics: "Information Technology" },
  { etf: "XLV", name: "Health Care", gics: "Health Care" },
  { etf: "XLF", name: "Financials", gics: "Financials" },
  { etf: "XLY", name: "Consumer Discretionary", gics: "Consumer Discretionary" },
  { etf: "XLC", name: "Communication Services", gics: "Communication Services" },
  { etf: "XLI", name: "Industrials", gics: "Industrials" },
  { etf: "XLP", name: "Consumer Staples", gics: "Consumer Staples" },
  { etf: "XLE", name: "Energy", gics: "Energy" },
  { etf: "XLU", name: "Utilities", gics: "Utilities" },
  { etf: "XLRE", name: "Real Estate", gics: "Real Estate" },
  { etf: "XLB", name: "Materials", gics: "Materials" },
];

export const GICS_TO_ETF: Record<string, string> = Object.fromEntries(
  SECTORS.map((s) => [s.gics, s.etf]),
);

export const ETF_TO_SECTOR: Record<string, SectorMeta> = Object.fromEntries(
  SECTORS.map((s) => [s.etf, s]),
);

export const SECTOR_ETFS: string[] = SECTORS.map((s) => s.etf);
