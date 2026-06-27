/**
 * Congressional stock trades, scraped from the U.S. Senate's public Electronic Financial
 * Disclosure system (efdsearch.senate.gov) — members file Periodic Transaction Reports (PTRs)
 * under the STOCK Act, ~30–45 days after each trade. The heavy lifting (agreement handshake,
 * paginated PTR search, per-report transaction parsing) happens offline in
 * scripts/refresh-congress.ts → data/congress.json; this module owns the types + loader.
 *
 * Public records, but a lagged + range-only view: amounts are disclosed as broad brackets
 * ($1,001–$15,000 …), Senate only for now (House PTRs are PDFs that parse poorly), and a trade
 * can surface up to 45 days late.
 */
import { promises as fsp } from "fs";
import path from "path";

export type TradeType = "buy" | "sell" | "exchange";

export interface CongressTrade {
  member: string; // "John Boozman"
  chamber: "Senate" | "House" | "Executive";
  ticker: string;
  asset: string; // issuer / fund name as disclosed
  type: TradeType;
  txDate: string; // YYYY-MM-DD — transaction date
  filedDate: string; // YYYY-MM-DD — disclosure date
  lagDays: number; // filed − transaction
  amountLow: number; // $ bracket low
  amountHigh: number; // $ bracket high
  owner: string; // Self / Spouse / Joint / Child
}

export interface TickerTally {
  ticker: string;
  asset: string;
  buys: number;
  sells: number;
  count: number;
  members: number; // distinct members trading it
  notional: number; // summed bracket midpoints
}

export interface MemberTally {
  member: string;
  chamber: string;
  trades: number;
  buys: number;
  sells: number;
  tickers: number;
  lastTrade: string;
}

export interface CongressData {
  generatedAt: string;
  since: string; // earliest transaction date in the set
  trades: CongressTrade[]; // newest transaction first
  topTickers: TickerTally[];
  topMembers: MemberTally[];
}

let _cache: Promise<CongressData | null> | null = null;

export function loadCongress(): Promise<CongressData | null> {
  if (!_cache)
    _cache = fsp
      .readFile(path.join(process.cwd(), "data", "congress.json"), "utf8")
      .then((s) => JSON.parse(s) as CongressData)
      .catch(() => null);
  return _cache;
}

// President Trump's OGE Form 278-T trades (chamber "Executive"), built separately by
// scripts/refresh-trump.ts — the executive branch files with OGE, not the Congressional eFD.
export interface TrumpData {
  generatedAt: string;
  filed: string; // disclosure date of the OGE filing
  source: string;
  since: string;
  totals: { count: number; buys: number; sells: number; notionalLow: number; notionalHigh: number };
  trades: CongressTrade[];
}

let _trumpCache: Promise<TrumpData | null> | null = null;

export function loadTrump(): Promise<TrumpData | null> {
  if (!_trumpCache)
    _trumpCache = fsp
      .readFile(path.join(process.cwd(), "data", "trump-trades.json"), "utf8")
      .then((s) => JSON.parse(s) as TrumpData)
      .catch(() => null);
  return _trumpCache;
}
