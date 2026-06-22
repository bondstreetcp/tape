/**
 * Closed-end fund (CEF) screener data. A CEF has a fixed share count and no ETF-style
 * create/redeem arbitrage, so its market price floats free of NAV and can swing to large
 * premiums/discounts — the discount is the whole game. Sourced from CEF Connect's public
 * daily-pricing feed (one call returns the full ~360-fund universe with NAV, premium/discount,
 * the discount z-score vs the fund's own history, distribution rate, leverage, etc.).
 * Built offline by scripts/refresh-cef.ts → data/cef.json.
 */
import { promises as fsp } from "fs";
import path from "path";

// Coarse asset-class buckets for the quick filter ("which class is out of favor").
export type CefGroup = "Fixed Income" | "Equity" | "Allocation" | "Other";

export interface Cef {
  ticker: string;
  name: string;
  sponsor: string;
  category: string; // Morningstar category, prefix stripped (e.g. "High Yield")
  group: CefGroup;
  strategy: string | null;
  price: number;
  nav: number;
  discount: number; // premium/discount %: negative = discount (price < NAV), positive = premium
  z1y: number | null; // discount z-score vs trailing 1yr (negative = cheaper than its own norm)
  z6m: number | null;
  disc52w: number | null; // 52-week average premium/discount %
  distRate: number | null; // distribution rate on price, %
  distFreq: string | null;
  leverage: number | null; // effective leverage, %
  expense: number | null; // expense ratio, % (incl. interest expense for levered funds)
  mktCapM: number | null; // market cap, $m
  avgCoupon: number | null;
  avgMaturity: number | null; // years
  effDuration: number | null; // leverage-adjusted effective duration, years
  ret3yNav: number | null; // 3yr annualized return on NAV, %
  retYtdPrice: number | null;
  navTicker: string | null;
  navDate: string | null; // NAV as-of date
}

export interface CefData {
  generatedAt: string;
  asOf: string | null; // latest NAV date in the set
  funds: Cef[];
}

let _cache: Promise<CefData | null> | null = null;

export function loadCef(): Promise<CefData | null> {
  if (!_cache)
    _cache = fsp
      .readFile(path.join(process.cwd(), "data", "cef.json"), "utf8")
      .then((s) => JSON.parse(s) as CefData)
      .catch(() => null);
  return _cache;
}

export const CEF_GROUPS: CefGroup[] = ["Fixed Income", "Equity", "Allocation", "Other"];

/** Bucket a Morningstar category / strategy into a coarse asset class. */
export function cefGroup(category: string, strategy: string | null): CefGroup {
  const c = category.toLowerCase();
  const s = (strategy || "").toLowerCase();
  if (
    s.startsWith("fixed income") ||
    /municipal|high yield|senior loan|investment grade|preferred|multi-sector|bond|income|credit|duration|debt|taxable|emerging market debt/.test(c)
  )
    return "Fixed Income";
  if (/allocation|balanced/.test(c)) return "Allocation";
  if (/equity|covered call|option|sector|infrastructure|real estate|reit|mlp|energy|commodit/.test(c) || s.startsWith("equity")) return "Equity";
  return "Other";
}
