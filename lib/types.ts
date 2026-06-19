import type { TimeframeKey } from "./timeframes";

export type Returns = Record<TimeframeKey, number | null>; // percent values, e.g. 1.23 = +1.23%

export interface StockRow {
  symbol: string;
  name: string;
  etf: string; // sector ETF this stock rolls up to
  sector: string; // GICS sector label
  industry: string; // GICS sub-industry — used for treemap grouping
  marketCap: number;
  price: number;
  returns: Returns;
  fiftyTwoWeekHigh: number;
  fiftyTwoWeekLow: number;
  pctFromHigh: number; // (price/high - 1) * 100, <= 0
  pctFromLow: number; // (price/low - 1) * 100, >= 0
}

export interface SectorAgg {
  etf: string;
  name: string;
  returns: Returns; // the ETF's own returns
  count: number; // number of constituents
  marketCap: number; // summed constituent market cap
}

export interface Snapshot {
  generatedAt: string; // ISO timestamp
  stocks: StockRow[];
  sectors: SectorAgg[];
}

export interface SeriesPoint {
  t: number; // epoch ms
  c: number; // close
}

export interface SectorSeries {
  etf: string;
  intraday: SeriesPoint[]; // ~5 trading days at 15m resolution
  daily: SeriesPoint[]; // ~1 year of daily closes
}

// Compact [epochMs, close] tuple — used for the bulky per-constituent series.
export type XY = [number, number];

export interface StockSeries {
  intraday: XY[];
  daily: XY[];
}

// One file per sector: every constituent's price series, keyed by symbol.
export interface ConstituentSeriesFile {
  etf: string;
  stocks: Record<string, StockSeries>;
}
