/**
 * Campaigns — who's publicly pressuring or betting against a company: activist stakes (SEC Schedule
 * 13D), proxy fights (DEFC14A / PREC14A / DFAN14A), and short-seller reports (Muddy Waters &c.). An LLM
 * extracts the target, the campaigner, and the ASK/allegation, and we track the stock since. Built by
 * scripts/refresh-campaigns.ts → data/campaigns.json.
 *
 * CLIENT-SAFE: types + pure helpers (no fs). This is a public-disclosure tracker, not advice.
 */

export type CampaignType = "activist" | "proxy-fight" | "short";

export interface CampPerf {
  priceAtEvent: number | null;
  priceNow: number | null;
  sincePct: number | null;
}

export interface Campaign {
  id: string; // SEC accession or report URL
  date: string; // ISO
  type: CampaignType;
  ticker: string | null;
  company: string;
  campaigner: string; // activist / dissident / short firm
  form: string; // SEC form or "short report"
  ask: string; // what they want (activist) / allege (short) — one line
  summary: string; // 1-2 sentence LLM read
  url: string;
  perf?: CampPerf | null;
}

export interface CampaignsData {
  generatedAt: string;
  scanned: number;
  campaigns: Campaign[]; // newest first
}

export const typeColor = (t: CampaignType): string => (t === "short" ? "#ef4444" : t === "proxy-fight" ? "#f59e0b" : "#60a5fa");
export const typeLabel = (t: CampaignType): string => (t === "short" ? "Short report" : t === "proxy-fight" ? "Proxy fight" : "Activist stake");
export const perfColor = (v: number | null | undefined): string => (v == null ? "var(--text-4)" : v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "var(--text-2)");
