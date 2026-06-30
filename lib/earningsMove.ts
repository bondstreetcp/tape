/**
 * Earnings expected-move screener. For names reporting in the next ~2 weeks, the ATM straddle
 * priced through the report is the market's *implied* move; the average of the last several
 * post-earnings one-day reactions is the *historical* move. Their ratio (richness) flags where
 * options are pricing the event richer or cheaper than the stock has actually moved — the
 * premium-seller's and the straddle-buyer's screen.
 *
 * Built offline by scripts/refresh-earnings-move.ts → data/earnings-move.json (chain straddle +
 * lib/earningsReaction history). This module owns the types + the loader.
 */
import { promises as fsp } from "fs";
import path from "path";

export interface EarningsMoveRow {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  marketCap: number;
  earningsDate: string; // ISO
  daysToEarnings: number;
  earningsEstimate: boolean; // Yahoo's date is an estimate, not confirmed
  expiry: string; // the option expiry just after earnings (captures the event)
  dte: number;
  straddle: number; // ATM straddle price per share
  impliedMovePct: number; // straddle / spot — the market's priced move
  impliedIV: number | null; // annualized IV implied by the straddle (more reliable than vendor iv)
  histAvgMovePct: number | null; // mean |1-day post-earnings reaction| over the last `histN` quarters
  histMaxMovePct: number | null; // largest single reaction in that window
  histN: number;
  richness: number | null; // impliedMovePct / histAvgMovePct (>1 = options pricing more than history)
  beatUp: number | null; // of past EPS beats, fraction where the stock rose (low = sell-the-news)
  beatN: number; // number of past beats in the sample
}

export interface EarningsMoveData {
  generatedAt: string;
  source: string;
  windowDays: number;
  rows: EarningsMoveRow[];
}

let _cache: Promise<EarningsMoveData | null> | null = null;
export function loadEarningsMove(): Promise<EarningsMoveData | null> {
  if (!_cache)
    _cache = fsp
      .readFile(path.join(process.cwd(), "data", "earnings-move.json"), "utf8")
      .then((s) => JSON.parse(s) as EarningsMoveData)
      .catch(() => null);
  return _cache;
}
