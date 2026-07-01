/**
 * Trade-log: the track record for the Earnings-prep card's suggested plays. Every night the logger
 * (scripts/refresh-trade-log.ts) records the concrete structure the card would suggest for names about
 * to report — with entry premiums + expiry — then, after the print and again at expiry, settles it and
 * scores the outcome. This turns "here's an idea" into "here's how these ideas have actually done."
 *
 * CLIENT-SAFE: types + pure settlement math ONLY (no fs, no network). The nightly generator lives in
 * lib/earningsTrade.ts (server) and the JSON is read server-side in the page. NEVER add fs here — the
 * track-record view value-imports settleLegs/summarize, which would drag fs into the client bundle.
 */

export interface TradeLeg {
  type: "C" | "P";
  side: "long" | "short";
  strike: number;
  premium: number; // per-share mid (or last) captured at generation time
}

export type TradeStatus = "awaiting_print" | "awaiting_expiry" | "settled";
export type Outcome = "win" | "loss" | "scratch";

export interface TradeRec {
  id: string; // `${symbol}-${earningsDate}` — one logged play per name per print
  symbol: string;
  name: string;
  sector?: string;
  loggedAt: string; // ISO datetime the rec was first written
  asOfDate: string; // YYYY-MM-DD of the market data behind it
  earningsDate: string; // ISO
  verdict: "rich" | "cheap";
  structure: string;
  legsText: string;
  expiry: string; // YYYY-MM-DD (the expiry bracketing the event)
  dte: number;
  spotAtRec: number;
  impliedMovePct: number;
  avgRealizedPct: number; // historical avg |1-day move| known at rec time
  richnessRatio: number; // implied / historical
  legs: TradeLeg[];
  entryCredit: number; // per-share net cash at entry (+ credit received, − debit paid)
  maxProfit: number | null; // per share; null = unbounded (long tail)
  maxLoss: number | null; // per share (negative); null = unbounded (naked short call tail)

  // ── settlement (filled in on later runs) ──
  status: TradeStatus;
  spotAtEarnings?: number | null; // close on the reaction day
  realizedMovePct?: number | null; // signed 1-day post-earnings reaction, %
  moveCleared?: boolean | null; // did |realized| exceed the implied move (a long-premium buyer's win)?
  spotAtExpiry?: number | null; // underlying at/after expiry
  settledAt?: string | null; // ISO datetime settled
  pnl?: number | null; // per-share P&L held to expiry (options settle to intrinsic)
  outcome?: Outcome | null;
}

export interface TradeLogData {
  generatedAt: string;
  recs: TradeRec[];
}

// Net cash at entry, per share: short legs COLLECT premium (+), long legs PAY it (−).
export function netCredit(legs: TradeLeg[]): number {
  return legs.reduce((s, l) => s + (l.side === "short" ? l.premium : -l.premium), 0);
}

// P&L per share if held to expiry with the underlying settling at S. Options expire to intrinsic, so
// this is exact at expiry: entry cash flow + the intrinsic value of each leg from our side of it.
export function settleLegs(legs: TradeLeg[], S: number): number {
  let pnl = netCredit(legs);
  for (const l of legs) {
    const intrinsic = l.type === "C" ? Math.max(S - l.strike, 0) : Math.max(l.strike - S, 0);
    pnl += l.side === "short" ? -intrinsic : intrinsic; // short owes intrinsic; long receives it
  }
  return pnl;
}

// Max profit / max loss over the payoff at expiry. The underlying can't go below 0 (downside is always
// bounded), so only the UPSIDE tail can be open — detected from the slope past the highest strike
// (a net short call → unbounded loss up; a net long call → unbounded profit up).
export function payoffBounds(legs: TradeLeg[]): { maxProfit: number | null; maxLoss: number | null } {
  if (!legs.length) return { maxProfit: null, maxLoss: null };
  const ks = [...new Set(legs.map((l) => l.strike))].sort((a, b) => a - b);
  const hi = ks[ks.length - 1] * 3 + 20;
  const grid = [0, ...ks, hi];
  const vals = grid.map((S) => settleLegs(legs, S));
  const slopeHi = settleLegs(legs, hi) - settleLegs(legs, hi - 1); // P&L slope far above the top strike
  const profitUnboundedUp = slopeHi > 1e-9;
  const lossUnboundedUp = slopeHi < -1e-9;
  return {
    maxProfit: profitUnboundedUp ? null : Math.max(...vals),
    maxLoss: lossUnboundedUp ? null : Math.min(...vals),
  };
}

// Provisional P&L for an OPEN rec, marked at the current underlying as if it settled to intrinsic now.
// Understates a short option's remaining time value/risk — display only, clearly labelled in the UI.
export function markToIntrinsic(rec: TradeRec, spotNow: number): number {
  return settleLegs(rec.legs, spotNow);
}

export interface TradeStats {
  settledN: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number | null; // wins / (wins + losses)
  avgPnl: number | null; // mean per-share P&L across settled
  totalPnl: number; // sum per-share P&L across settled (1-lot each)
  clearedN: number; // settled where the print already has a realized move recorded
  cleared: number; // of those, how often the move EXCEEDED implied (long-premium would have paid)
  byVerdict: Record<"rich" | "cheap", { n: number; wins: number; avgPnl: number | null }>;
  openN: number;
}

// Aggregate the track record: win rate + avg P&L across SETTLED recs, split by rich (sell-premium) vs
// cheap (buy-premium), plus how often the realized move cleared what options priced.
export function summarize(recs: TradeRec[]): TradeStats {
  const settled = recs.filter((r) => r.status === "settled" && r.pnl != null);
  const wins = settled.filter((r) => r.outcome === "win").length;
  const losses = settled.filter((r) => r.outcome === "loss").length;
  const scratches = settled.filter((r) => r.outcome === "scratch").length;
  const pnls = settled.map((r) => r.pnl as number);
  const withMove = recs.filter((r) => r.moveCleared != null);
  const mk = (v: "rich" | "cheap") => {
    const g = settled.filter((r) => r.verdict === v);
    const gw = g.filter((r) => r.outcome === "win").length;
    return { n: g.length, wins: gw, avgPnl: g.length ? g.reduce((a, r) => a + (r.pnl as number), 0) / g.length : null };
  };
  return {
    settledN: settled.length,
    wins,
    losses,
    scratches,
    winRate: wins + losses > 0 ? wins / (wins + losses) : null,
    avgPnl: pnls.length ? pnls.reduce((a, b) => a + b, 0) / pnls.length : null,
    totalPnl: pnls.reduce((a, b) => a + b, 0),
    clearedN: withMove.length,
    cleared: withMove.filter((r) => r.moveCleared).length,
    byVerdict: { rich: mk("rich"), cheap: mk("cheap") },
    openN: recs.filter((r) => r.status !== "settled").length,
  };
}
