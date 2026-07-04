/**
 * Vol Dislocation — a cross-sectional read on where option vol is rich or cheap across the (quality
 * large/mid-cap) universe. Built from data/putwrite.json (which already solves an ATM IV + realized vol
 * per name every night), so it costs ZERO extra option fetches. The core signal is the VARIANCE PREMIUM
 * (ATM IV ÷ realized vol): high = the market's paying up for vol (a premium-seller's hunting ground),
 * low = vol looks underpriced. Term crush (front/back IV) and skew (put − call IV) add context, and
 * near-earnings names are flagged (their rich vol is expected, not a free dislocation). Decision support,
 * not advice — a rich name may simply be pricing a real catalyst (that's the LLM "why" tag, phase 2).
 */

export interface VolDisRow {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  marketCap: number;
  atmIV: number; // decimal (0.45 = 45%)
  rvol: number; // realized vol, decimal
  ivPremium: number; // atmIV ÷ rvol — the variance premium
  termCrush: number | null; // front-tenor IV ÷ back-tenor IV (>1 = backwardated / event-loaded)
  skew: number | null; // front put IV − call IV, decimal (>0 = downside richer)
  ivRank: number | null; // IV percentile (accrues over time; may be null)
  rvolRank: number | null;
  daysToEarnings: number | null;
  earningsDriven: boolean; // earnings land inside the front expiry → the rich vol is EXPECTED, not a dislocation
  sectorPremium: number | null; // the median IV/RV across this name's sector — the peer baseline
  vsSector: number | null; // ivPremium − sector median; >0 = richer vol than its sector (peer-relative)
  pctile: number; // cross-sectional ivPremium percentile (0–100)
  illiquid?: boolean; // broad-universe name with thin options — treat its vol read with caution
  broad?: boolean; // sourced from the wide R1000/R3000 probe (vs the curated put-writing quality set)
  catalyst?: { text: string; kind: "event" | "unclear"; confidence: number }; // LLM "why the vol is rich", grounded in recent headlines (phase 2)
}

// One row of the BROAD vol probe (scripts/refresh-vol-universe.ts). Same per-name fields the dislocation
// transform needs, computed directly from a wide-universe option pull — merged in by refresh-vol-dislocation
// (which prefers the richer put-writing rows where a name appears in both).
export interface VolUniRow {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  marketCap: number;
  atmIV: number;
  rvol: number;
  ivPremium: number;
  termCrush: number | null;
  skew: number | null;
  ivRank: number | null;
  rvolRank: number | null;
  daysToEarnings: number | null;
  earningsDriven: boolean;
  illiquid: boolean;
}
export interface VolUniData {
  generatedAt: string;
  universe: string;
  scanned: number;
  rows: VolUniRow[];
}

export interface VolDisData {
  generatedAt: string;
  universe: string;
  scanned: number;
  rows: VolDisRow[];
}

// variance-premium color: red/amber = rich vol (sell), teal = cheap vol (buy)
export function premColor(p: number): string {
  if (p >= 1.8) return "#ef4444";
  if (p >= 1.4) return "#f59e0b";
  if (p <= 0.95) return "#14b8a6";
  if (p <= 1.1) return "#2dd4bf";
  return "var(--text-2)";
}
export const premVerdict = (p: number): "rich" | "cheap" | "fair" => (p >= 1.4 ? "rich" : p <= 1.1 ? "cheap" : "fair");
