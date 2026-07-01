/**
 * IPO & Lockups monitor — recent IPOs (SEC 424B4 final prospectuses) and the IPO-lockup-expiry
 * calendar (IPO date + ~180 days), when insiders/VCs can first sell and supply hits the stock. Built
 * by scripts/refresh-ipo.ts. A public-disclosure tracker, not advice. (Index add/deletes need a
 * separate S&P/Russell source and aren't included here.)
 */

export type IpoKind = "ipo" | "lockup" | "upcoming";

export interface IpoSummary {
  business: string; // what the company does
  sector: string;
  financials: string; // revenue / growth / profitability snapshot
  useOfProceeds: string; // what they'll do with the money
  risks: string[]; // 2-4 key risk factors
  underwriters?: string[]; // lead / book-running managers (undefined = pre-underwriter-extraction summary)
}

export interface IpoEvent {
  id: string; // accession
  kind: IpoKind;
  ticker: string; // may be a proposed ticker for upcoming filings
  company: string;
  ipoDate: string; // ISO — the 424B4 pricing date (recent/lockup) or the S-1 filing date (upcoming)
  lockupDate: string | null; // ISO — IPO date + ~180d (for the lockup calendar)
  daysToLockup: number | null; // signed days until the unlock
  priceUsd: number | null; // IPO price (or proposed range midpoint)
  sizeUsdM: number | null; // deal size, $M
  exchange: string;
  sinceIpoPct: number | null; // return from the IPO price to now (recent/lockup only)
  url: string; // the SEC prospectus
  summary?: IpoSummary | null; // AI recap of the S-1 / prospectus (what the company does)
}

export interface IpoData {
  generatedAt: string;
  scanned: number;
  events: IpoEvent[];
}

export const perfColor = (v: number | null | undefined): string => (v == null ? "var(--text-4)" : v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "var(--text-2)");
export const fmtSize = (m: number | null): string => (m == null ? "—" : m >= 1000 ? `$${(m / 1000).toFixed(1)}B` : `$${m.toFixed(0)}M`);
