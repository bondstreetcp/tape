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

// ── Sell-Premium Board (the composite decision score) ──────────────────────────────────────────────
// The vol-dislocation / skew / term-structure screens each show ONE lens on the same dataset. For a
// premium SELLER the decision is a blend: is vol rich vs its own realized (the variance premium), rich
// vs where it usually trades (IV rank), and rich vs its sector peers (vsSector) — AND is that richness a
// genuine dislocation rather than just an imminent earnings event you'd be short into (the trap). This
// folds those into one 0–100 "sell score", earnings-trap-haircut included, so the board ranks WHERE to
// put premium-selling capital right now. Decision support, not advice.
export interface SellScore {
  score: number; // 0–100
  earningsTrap: boolean; // rich vol is pricing an imminent earnings event inside the front expiry
  side: "puts" | "calls" | "either"; // which side the skew says is the richer sell
  drivers: string[]; // short human tags for the notable contributors
}
export function sellPremiumScore(r: VolDisRow): SellScore {
  const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
  const parts: { w: number; v: number }[] = [];
  const drivers: string[] = [];
  // Variance premium (absolute) — IV vs the name's OWN realized. The core edge; always present.
  parts.push({ w: 0.45, v: clamp01((r.ivPremium - 1.0) / 0.9) }); // 1.0×→0, ≥1.9×→1
  if (r.ivPremium >= 1.4) drivers.push(`IV ${r.ivPremium.toFixed(2)}× realized`);
  // IV rank — rich vs where this name's vol usually sits (accrues over time; may be null).
  if (r.ivRank != null) { parts.push({ w: 0.30, v: clamp01(r.ivRank / 100) }); if (r.ivRank >= 70) drivers.push(`IV rank ${Math.round(r.ivRank)}ᵗʰ`); }
  // Peer-relative — richer variance premium than its sector median.
  if (r.vsSector != null) { parts.push({ w: 0.25, v: clamp01(r.vsSector / 0.4) }); if (r.vsSector >= 0.15) drivers.push(`+${r.vsSector.toFixed(2)} vs sector`); }
  const wSum = parts.reduce((a, p) => a + p.w, 0) || 1;
  let score = (100 * parts.reduce((a, p) => a + p.w * p.v, 0)) / wSum; // re-normalized if IV-rank/sector missing
  const earningsTrap = !!r.earningsDriven;
  if (earningsTrap) { score *= 0.45; drivers.push("earnings inside front — event risk, not free premium"); }
  const side: SellScore["side"] = r.skew == null ? "either" : r.skew >= 0.05 ? "puts" : r.skew <= -0.03 ? "calls" : "either";
  return { score: Math.round(score), earningsTrap, side, drivers };
}
export function sellScoreColor(s: number): string {
  if (s >= 70) return "#22c55e";
  if (s >= 50) return "#84cc16";
  if (s >= 30) return "var(--text-2)";
  return "var(--text-4)";
}
