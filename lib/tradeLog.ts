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
import { bsPrice, ivFromPrice } from "./blackScholes";

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

  // Caution flag: a recently DISCLOSED, still-LIVE corporate catalyst (strategic-alternatives review /
  // spin-off in motion, from data/corp-events.json; resolved events filtered out) may be WHY vol is
  // elevated into this print — the update lands on the call, so a "rich → sell premium" read can be
  // selling event risk, not vol mispricing (the ISRG lesson). Stamped at LOG time and RE-CHECKED
  // nightly: a flag is ADDED whenever the disclosure date precedes the rec's print (provably pre-print,
  // so honest even when noticed late), and never cleared. ANNOTATION ONLY: the play still logs and
  // grades normally, so the record can MEASURE whether flagged sell-vol plays underperform.
  catalystFlag?: { kind: "strategic-alt" | "spin-off"; headline: string; date: string } | null;

  // ── settlement (filled in on later runs) ──
  status: TradeStatus;
  spotAtEarnings?: number | null; // close on the reaction day
  realizedMovePct?: number | null; // signed 1-day post-earnings reaction, %
  moveCleared?: boolean | null; // did |realized| exceed the implied move (a long-premium buyer's win)?
  spotAtExpiry?: number | null; // underlying at/after expiry
  settledAt?: string | null; // ISO datetime settled
  pnl?: number | null; // per-share P&L — the PRIMARY grade (post-print for new recs; see settleBasis)
  outcome?: Outcome | null;
  settleBasis?: "post-print" | "expiry"; // how pnl was graded (older recs: expiry; new: the print)
  pnlToExpiry?: number | null; // secondary, informational: what it would have been if held to expiry
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

// Value the structure THE MORNING AFTER THE PRINT — the honest grade for an earnings play, which is a
// bet on the print itself, not on where the stock drifts to weeks later at expiry. We strip the EVENT's
// variance (the one-shot jump the straddle priced at entry) out of each leg's implied variance, then
// reprice with Black-Scholes at the post-print spot + remaining time. There's no magic crush constant:
// the event variance is exactly what the implied move priced (straddle/S ≈ 0.8·σ·√T ⇒ the event's 1σ
// jump ≈ impliedMove/0.8, variance = that squared). Returns per-share P&L from our side, or null.
export function settlePostPrint(rec: TradeRec, reactionSpot: number, daysToExpiryAfter: number): number | null {
  if (!(reactionSpot > 0) || !rec.legs.length) return null;
  const Tentry = Math.max(rec.dte, 1) / 365;
  const Tpost = Math.max(daysToExpiryAfter, 0) / 365;
  const eventVar = Math.pow(rec.impliedMovePct / 100 / 0.8, 2); // the variance the print resolved
  let pnl = 0;
  for (const l of rec.legs) {
    const kind = l.type === "C" ? "call" : "put";
    let mark: number;
    if (Tpost <= 0) {
      mark = kind === "call" ? Math.max(reactionSpot - l.strike, 0) : Math.max(l.strike - reactionSpot, 0);
    } else {
      const sigEntry = ivFromPrice(kind, rec.spotAtRec, l.strike, Tentry, l.premium);
      if (sigEntry == null) return null;
      const remVar = Math.max(sigEntry * sigEntry * Tentry - eventVar, 0); // whole-life diffusive variance minus the spent event
      // remVar is the diffusion budget over the ENTIRE entry→expiry life; the residual annualized
      // vol is √(remVar / Tentry). Pricing the residual leg over the (shorter) remaining time Tpost
      // must hold that annualized vol constant — NOT force the whole-life variance into Tpost, which
      // would over-state residual time value by Tentry/Tpost and corrupt the graded post-print P&L.
      mark = bsPrice(kind, reactionSpot, l.strike, Tpost, Math.sqrt(remVar / Tentry));
    }
    pnl += l.side === "long" ? mark - l.premium : l.premium - mark; // our side: long gains the mark, short buys it back
  }
  return pnl;
}

// ── Fixed-notional normalization ────────────────────────────────────────────────────────────────
// The scorecard used to sum per-share P&L "one contract each," which over-weights expensive
// underlyings: a $600 stock's straddle runs $30-40/share while a $50 stock's runs $1.50-2, so one UNH
// contract dwarfed one TFC contract in every dollar aggregate. Normalize instead to a FIXED DOLLAR
// NOTIONAL of underlying per play — contracts = notional / (spot × 100) — so every play expresses a
// same-size bet on its stock and P&Ls are comparable across names. Per-rec fields stay per-share
// (canonical; nothing in settlement changes); only aggregation and display rescale. The per-rec scale
// factor is positive, so win/loss outcomes — and therefore winRate — are IDENTICAL under either basis.
export const PLAY_NOTIONAL = 100_000;

/** Contracts a fixed underlying notional buys at the logged spot (fractional — a normalization, not an
 *  executable ticket). null on a degenerate spot. */
export function contractsFor(spotAtRec: number, notional = PLAY_NOTIONAL): number | null {
  return spotAtRec > 0 ? notional / (spotAtRec * 100) : null;
}

/** Per-share P&L → dollar P&L on a fixed underlying notional:
 *  pnl/share × 100 sh/contract × (notional / (spot × 100)) contracts = pnl × notional / spot. */
export function dollarPnl(pnlPerShare: number, spotAtRec: number, notional = PLAY_NOTIONAL): number | null {
  return spotAtRec > 0 ? (pnlPerShare * notional) / spotAtRec : null;
}

export interface TradeStats {
  settledN: number;
  wins: number;
  losses: number;
  scratches: number;
  winRate: number | null; // wins / (wins + losses)
  avgPnl: number | null; // mean DOLLAR P&L per settled play, each normalized to PLAY_NOTIONAL of underlying
  totalPnl: number; // sum of those dollar P&Ls (PLAY_NOTIONAL each)
  clearedN: number; // settled where the print already has a realized move recorded
  cleared: number; // of those, how often the move EXCEEDED implied (long-premium would have paid)
  byVerdict: Record<"rich" | "cheap", { n: number; wins: number; avgPnl: number | null }>; // avgPnl in the same notional dollars
  openN: number;
  preprintN: number; // logged, still awaiting their print (the live pre-print queue)
}

// Aggregate the track record: win rate + avg P&L across SETTLED recs, split by rich (sell-premium) vs
// cheap (buy-premium), plus how often the realized move cleared what options priced. Dollar aggregates
// are normalized to PLAY_NOTIONAL of underlying per play (see above); counts/rates are basis-free.
export function summarize(recs: TradeRec[]): TradeStats {
  const settled = recs.filter((r) => r.status === "settled" && r.pnl != null);
  const wins = settled.filter((r) => r.outcome === "win").length;
  const losses = settled.filter((r) => r.outcome === "loss").length;
  const scratches = settled.filter((r) => r.outcome === "scratch").length;
  const dollars = settled.map((r) => dollarPnl(r.pnl as number, r.spotAtRec)).filter((x): x is number => x != null);
  const withMove = recs.filter((r) => r.moveCleared != null);
  const mk = (v: "rich" | "cheap") => {
    const g = settled.filter((r) => r.verdict === v);
    const gw = g.filter((r) => r.outcome === "win").length;
    const gd = g.map((r) => dollarPnl(r.pnl as number, r.spotAtRec)).filter((x): x is number => x != null);
    return { n: g.length, wins: gw, avgPnl: gd.length ? gd.reduce((a, b) => a + b, 0) / gd.length : null };
  };
  return {
    settledN: settled.length,
    wins,
    losses,
    scratches,
    winRate: wins + losses > 0 ? wins / (wins + losses) : null,
    avgPnl: dollars.length ? dollars.reduce((a, b) => a + b, 0) / dollars.length : null,
    totalPnl: dollars.reduce((a, b) => a + b, 0),
    clearedN: withMove.length,
    cleared: withMove.filter((r) => r.moveCleared).length,
    byVerdict: { rich: mk("rich"), cheap: mk("cheap") },
    openN: recs.filter((r) => r.status !== "settled").length,
    preprintN: recs.filter((r) => r.status === "awaiting_print").length,
  };
}
