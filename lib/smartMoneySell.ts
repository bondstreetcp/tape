// Smart-Money Distribution — the SELL side of the super-investor 13Fs. The Smart-Money Radar shows what
// the gurus are accumulating; this shows what they're EXITING: names several managers fully sold out of
// or sharply trimmed last quarter. A guru sale is noisier than a buy (redemptions, rebalancing, risk
// limits — not just a broken thesis), so this is a "consensus is leaving" risk lens, not a short list.
// Selling into weakness (the stock is down) reads as capitulation; into strength (up) as profit-taking.
// Pure/client-safe: the page loads the 13F snapshot + a context snapshot and hands them here. No LLM.

import type { SuperInvestorsData } from "./superinvestors";

export interface SmartSeller {
  manager: string;
  action: "exited" | "trimmed";
  // Share-count change vs the prior quarter as a FRACTION (−0.82 = −82% of the position trimmed);
  // null for a full exit. The 13F pipeline stores deltaPct as deltaShares/priorShares (a fraction).
  deltaPct: number | null;
}

export interface DistributionName {
  symbol: string;
  name: string;
  sector: string | null;
  marketCap: number | null;
  price: number | null;
  retYtd: number | null;
  pctFromHigh: number | null;
  sellers: SmartSeller[]; // super-investors exiting / trimming last quarter
  exitedN: number; // fully sold out
  trimmedN: number; // sharply trimmed
  score: number;
  tone: "capitulation" | "profit-taking" | "mixed"; // read from the price context
}

interface Ctx { name?: string; sector?: string | null; marketCap?: number | null; price?: number | null; returns?: Record<string, number | null>; pctFromHigh?: number | null }

export function buildSmartMoneySell(si: SuperInvestorsData | null, ctxBy: Map<string, Ctx>): DistributionName[] {
  const bySym = new Map<string, { exited: Map<string, void>; trimmed: Map<string, number> }>();
  const slot = (t: string) => {
    let e = bySym.get(t);
    if (!e) { e = { exited: new Map(), trimmed: new Map() }; bySym.set(t, e); }
    return e;
  };
  for (const inv of si?.investors || []) {
    for (const s of inv.soldOut || []) if (s.ticker) slot(s.ticker).exited.set(inv.manager);
    for (const t of inv.topTrims || []) if (t.ticker) slot(t.ticker).trimmed.set(inv.manager, t.deltaPct);
  }

  const out: DistributionName[] = [];
  for (const [sym, e] of bySym) {
    // A manager who both trimmed AND (per another period) sold out counts once as the stronger "exited".
    const exitedMgrs = [...e.exited.keys()];
    const trimmedMgrs = [...e.trimmed.keys()].filter((m) => !e.exited.has(m));
    const sellersN = exitedMgrs.length + trimmedMgrs.length;
    if (sellersN < 2) continue; // require ≥2 managers = real distribution, not one manager rebalancing

    const sellers: SmartSeller[] = [
      ...exitedMgrs.map((m) => ({ manager: m, action: "exited" as const, deltaPct: null })),
      ...trimmedMgrs.map((m) => ({ manager: m, action: "trimmed" as const, deltaPct: e.trimmed.get(m) ?? null })),
    ];
    const c = ctxBy.get(sym);
    // Full exits weigh double a trim; a magnitude bonus from the average trim DEPTH (deltaPct is a
    // fraction in [−1,0], so a −0.9 trim ≈ a near-exit and adds up to +1).
    const trimDepth = trimmedMgrs.length ? trimmedMgrs.reduce((n, m) => n + Math.abs(e.trimmed.get(m) ?? 0), 0) / trimmedMgrs.length : 0;
    const score = exitedMgrs.length * 2 + trimmedMgrs.length + Math.min(trimDepth, 1);
    const ytd = c?.returns?.["ytd"] ?? null;
    const tone: DistributionName["tone"] = ytd == null ? "mixed" : ytd < -5 ? "capitulation" : ytd > 5 ? "profit-taking" : "mixed";
    out.push({
      symbol: sym,
      name: c?.name || sym,
      sector: c?.sector ?? null,
      marketCap: c?.marketCap ?? null,
      price: c?.price ?? null,
      retYtd: ytd,
      pctFromHigh: c?.pctFromHigh ?? null,
      sellers: sellers.sort((a, b) => (a.action === b.action ? 0 : a.action === "exited" ? -1 : 1)),
      exitedN: exitedMgrs.length,
      trimmedN: trimmedMgrs.length,
      score: Math.round(score * 10) / 10,
      tone,
    });
  }
  return out.sort((a, b) => b.score - a.score || b.exitedN - a.exitedN || (b.marketCap ?? 0) - (a.marketCap ?? 0));
}

export const toneColor = (t: DistributionName["tone"]): string => (t === "capitulation" ? "#ef4444" : t === "profit-taking" ? "#f59e0b" : "var(--text-3)");
export const toneLabel = (t: DistributionName["tone"]): string => (t === "capitulation" ? "into weakness" : t === "profit-taking" ? "into strength" : "mixed");
