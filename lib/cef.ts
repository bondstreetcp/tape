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
// "Alternatives" = private equity / property / infrastructure / renewables / commodities —
// big in the UK investment-trust space and exactly where discounts blow out.
export type CefGroup = "Fixed Income" | "Alternatives" | "Equity" | "Allocation" | "Other";

/** An activist campaign on file for this fund (joined at render from data/campaigns.json). CEF
 *  activism is the discount-closing mechanism: a 13D from a Saba/Bulldog-class filer is historically
 *  what turns "cheap vs its own history" into an actual catalyst (tenders, open-ending, board seats). */
export interface CefActivist {
  campaigner: string;
  date: string; // YYYY-MM-DD of the filing
  form: string; // SCHEDULE 13D / DEFC14A / …
  ask: string | null;
  url: string;
}

/** Latest campaign per CEF ticker — pure join so it's testable; short-seller reports are excluded
 *  (a short report on a fund is not the discount-closing kind of attention). */
export function latestCampaignByTicker(
  campaigns: { ticker?: string | null; type?: string; campaigner?: string; date: string; form?: string; ask?: string | null; url?: string }[],
  cefTickers: Set<string>,
): Map<string, CefActivist> {
  const out = new Map<string, CefActivist>();
  for (const c of campaigns) {
    if (!c.ticker || !cefTickers.has(c.ticker)) continue;
    if (c.type === "short-report" || c.type === "short") continue;
    const cur = out.get(c.ticker);
    if (cur && cur.date >= c.date) continue;
    out.set(c.ticker, { campaigner: c.campaigner || "Activist", date: c.date, form: c.form || "13D", ask: c.ask ?? null, url: c.url || "" });
  }
  return out;
}

export interface Cef {
  ticker: string;
  name: string;
  /** set by the page-level join against the campaigns feed — absent when no campaign is on file */
  activist?: CefActivist;
  region: "US" | "UK"; // US = CEF Connect; UK = London-listed investment trust (Morningstar)
  currency: string; // major-currency code for price/NAV/cap display (USD, GBP, EUR…)
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

/** Bucket a Morningstar category / strategy into a coarse asset class. Order matters —
 *  "Private Equity" must hit Alternatives before the generic "equity" test. */
export function cefGroup(category: string, strategy: string | null): CefGroup {
  const c = category.toLowerCase();
  const s = (strategy || "").toLowerCase();
  if (
    s.startsWith("fixed income") ||
    /municipal|high yield|senior loan|investment grade|preferred|multi-sector|bond|income|credit|duration|debt|taxable|loan|emerging market debt/.test(c)
  )
    return "Fixed Income";
  if (/private equity|property|real estate|reit|infrastructure|renewable|commodit|natural resources|royalt|leasing|farmland|forestry|mlp|energy/.test(c)) return "Alternatives";
  if (/allocation|balanced|flexible/.test(c)) return "Allocation";
  if (/equity|covered call|option|sector/.test(c) || s.startsWith("equity")) return "Equity";
  return "Other";
}
