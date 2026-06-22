import type { TimeframeKey } from "./timeframes";

export type Returns = Record<TimeframeKey, number | null>; // percent values, e.g. 1.23 = +1.23%

/** Trend fundamentals computed from annual fundamentalsTimeSeries (fractions, except DSO in days). */
export interface Fundamentals {
  revGrowth: number | null; // latest FY YoY
  revCagr3y: number | null;
  grossMargin: number | null;
  opMargin: number | null;
  netMargin: number | null;
  grossMarginChg: number | null; // YoY change in margin (pp as fraction)
  opMarginChg: number | null;
  netMarginChg: number | null;
  dso: number | null; // days sales outstanding
  dsoChg: number | null; // YoY change in DSO (days)
  fcfMargin: number | null;
  fcfYield: number | null; // free cash flow ÷ market cap (cash-flow yield) — used by the ERP5 screen
  roe: number | null;
  roic: number | null; // NOPAT ÷ invested capital (return on invested capital) — used by the Moat screen
  netDebtEbitda: number | null;
  currentRatio: number | null;
  // deep-value / quality screen metrics (computed in patch-fundamentals-deep)
  ncav: number | null; // Graham net current asset value = current assets − total liabilities ($)
  fScore: number | null; // Piotroski F-score, 0–9 (higher = stronger fundamental momentum)
  shareholderYield: number | null; // Meb Faber: dividend + net buyback + net debt-paydown yield (fraction)
  asOf: string | null; // latest FY period end
}

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
  // valuation snapshot (from Yahoo quote; optional so older snapshots still load)
  trailingPE?: number | null;
  forwardPE?: number | null;
  priceToBook?: number | null;
  dividendYield?: number | null; // fraction, e.g. 0.012 = 1.2%
  fiftyDayAverage?: number | null;
  twoHundredDayAverage?: number | null;
  // next earnings (from the quote)
  earningsDate?: string | null; // ISO; earningsTimestampStart
  earningsEstimate?: boolean; // date is an estimate, not confirmed
  epsForward?: number | null;
  fund?: Fundamentals | null; // trend fundamentals (separate periodic patch)
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
