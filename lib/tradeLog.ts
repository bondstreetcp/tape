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
  /** Two-sided quote at capture, when one existed — lets the record grade a CROSSED fill (short sells
   *  at bid, long buys at ask) next to the mid. Absent on recs logged before 2026-08-05. */
  bid?: number | null;
  ask?: number | null;
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
  catalystFlag?: { kind: "strategic-alt" | "spin-off" | "acquisition" | "preannounce"; headline: string; date: string } | null;

  // ── risk instrumentation (2026-08-05, the "scale it up?" audit) — all LOG-time, all optional so
  // pre-existing recs stay valid. Only thin-credit is a MEASURED handicap (retro on 206 settled
  // sells: <1.5%-of-spot credits made $185/play vs the $1,468 average while carrying 3 of 12 tail
  // losses — uncompensated risk). The rest are CONTEXT logged so the hurricane-prediction question
  // can be re-asked at a real sample size — the same retro showed today's features do NOT separate
  // the tails (the worst losses had the FATTEST richness ratios), so no field here claims to. ──
  /** Entry credit if every leg fills at the WORSE side of its captured quote — the honest fill. */
  entryCreditCrossed?: number | null;
  /** Reg-T-floor margin to carry the position, per share of underlying (see marginPerShare). */
  marginPerShare?: number | null;
  /** Same, scaled to the $100k-notional basis every P&L on the board uses. */
  marginUsd100k?: number | null;
  /** CBOE VIX level on the log night (data/macro.json) — the regime stamp for later slicing. */
  vixAtLog?: number | null;
  /** Calendar days between the data date and the print — the unhedged drift window (the ATKR class:
   *  biggest tail loss in the first 227 settles came from a +31.7% PRE-print drift, 0% print move). */
  gapDays?: number | null;
  /** The name's largest single historical earnings move — a sell at implied below this is short a
   *  move the stock has already demonstrated. */
  histMaxPct?: number | null;
  /** Code-computed context chips (see computeRiskFlags). */
  riskFlags?: string[];

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
  /** Pre-print drift: how far the stock moved between logging and the print-eve close (the print's
   *  own move backed out of the reaction close). The tail the "bet on the print" framing hides. */
  driftMovePct?: number | null;
  /** pnl on the capital actually tied up (marginUsd100k), not on notional — the number a sizing
   *  decision needs. Absent when the rec predates the margin field. */
  retOnMarginPct?: number | null;
  /** Spread-cost fraction RE-MEASURED during market hours (scripts/capture-trade-spreads) — fresh
   *  two-sided quotes on the play's strikes, so a real liquidity read, not the sparse/inflated
   *  after-hours one. Preferred over the log-time spreadCostPct wherever it exists. */
  liveSpreadPct?: number | null;
  /** ISO datetime of the market-hours spread capture (so the UI can say "live" vs "after-hours"). */
  spreadCapturedAt?: string | null;
}

export interface TradeLogData {
  generatedAt: string;
  recs: TradeRec[];
}

// Net cash at entry, per share: short legs COLLECT premium (+), long legs PAY it (−).
export function netCredit(legs: TradeLeg[]): number {
  return legs.reduce((s, l) => s + (l.side === "short" ? l.premium : -l.premium), 0);
}

/**
 * Net entry cash if every leg fills at the WORSE side of its captured quote: shorts SELL at the bid,
 * longs BUY at the ask. The mid is what the log grades; this is what a market order actually gets —
 * the gap between them is the strategy's first, guaranteed cost. Null unless every leg carried a
 * two-sided quote (a crossed fill computed from half a book would be fiction).
 */
export function crossedCredit(legs: TradeLeg[]): number | null {
  let s = 0;
  for (const l of legs) {
    const px = l.side === "short" ? l.bid : l.ask;
    if (px == null || !(px > 0)) return null;
    s += l.side === "short" ? px : -px;
  }
  return +s.toFixed(4); // quotes are cents-quantized; don't leak float dust into the log
}

/**
 * Margin to CARRY the position, per share of underlying — the Reg-T floor, which is the honest
 * denominator for "return on capital" (portfolio margin is usually lighter; brokers vary; this is
 * the conservative standard formula, documented rather than guessed). Two candidate requirements:
 *   • RISK-BASED (when maxLoss is finite): the max loss — right for spreads/condors and long premium.
 *   • REG-T NAKED (when short legs exist): per side, premium + max(20% of spot − OTM amount, 10% of
 *     strike[put] / 10% of spot[call]); a strangle margins the GREATER side + the other's premium.
 * The requirement is the SMALLER of the two that apply: a naked short put has finite risk (stock
 * stops at zero) but no broker cash-secures it in a margin account — Reg-T's ~15% beats "strike −
 * premium" — while a condor's width−credit beats the naked formula. min() picks correctly for every
 * standard structure; both candidates absent (shouldn't happen with legs present) → null.
 */
export function marginPerShare(legs: TradeLeg[], spot: number): number | null {
  if (!legs.length || !(spot > 0)) return null;
  const { maxLoss } = payoffBounds(legs);
  const riskBased = maxLoss != null ? Math.max(0, -maxLoss) : null;
  const shorts = legs.filter((l) => l.side === "short");
  let regT: number | null = null;
  if (shorts.length) {
    const req = (l: TradeLeg): number => {
      const otm = l.type === "C" ? Math.max(0, l.strike - spot) : Math.max(0, spot - l.strike);
      const floor = l.type === "P" ? 0.1 * l.strike : 0.1 * spot;
      return l.premium + Math.max(0.2 * spot - otm, floor);
    };
    const calls = shorts.filter((l) => l.type === "C").map(req);
    const puts = shorts.filter((l) => l.type === "P").map(req);
    const callReq = calls.length ? Math.max(...calls) : 0;
    const putReq = puts.length ? Math.max(...puts) : 0;
    const callPrem = shorts.filter((l) => l.type === "C").reduce((a, l) => a + l.premium, 0);
    const putPrem = shorts.filter((l) => l.type === "P").reduce((a, l) => a + l.premium, 0);
    // Greater side's full requirement + the other side's premium (the standard strangle rule).
    regT = callReq >= putReq ? callReq + putPrem : putReq + callPrem;
  }
  if (riskBased != null && regT != null) return Math.min(riskBased, regT);
  return riskBased ?? regT;
}

/**
 * Pre-print drift: spotAtEarnings is the REACTION-day close, so back the print's own move out of it
 * to recover the print-eve close, then measure from the strike-setting spot. This is the exposure the
 * "bet on the print" framing hides — strikes are struck at log time, and the stock has days to walk
 * away from them before the event (the ATKR class: +31.7% drift, 0% print move, worst loss on file).
 */
export function prePrintDriftPct(spotAtRec: number, reactionClose: number, realizedMovePct: number): number | null {
  if (!(spotAtRec > 0) || !(reactionClose > 0)) return null;
  const evClose = reactionClose / (1 + realizedMovePct / 100);
  if (!(evClose > 0)) return null;
  return +(((evClose - spotAtRec) / spotAtRec) * 100).toFixed(2);
}

/** The one MEASURED handicap threshold: sells collecting under this share of spot are picking pennies
 *  (retro 2026-08-05: 39 such plays averaged $185 vs the book's $1,468 — with 3 of the 12 tails). */
export const THIN_CREDIT_PCT = 0.015;
/** A chain is "wide" when crossing it would forfeit at least this share of the mid credit. The
 *  book-wide crossing cost measured ~45% on average (data/trade-log, after-hours quotes), so a
 *  per-play ≥50% means the spread eats MORE than the typical edge — the credit won't survive real
 *  fills. Captured after-hours, so it is an UPPER BOUND / relative liquidity signal, not a promise. */
export const WIDE_SPREAD_PCT = 0.5;

/** Fraction of the mid entry credit a spread-crossing fill forfeits, from the legs' captured
 *  two-sided quotes (shorts fill at bid, longs at ask). Positive = cost; works for credit and debit
 *  entries alike. null unless entryCreditCrossed was captured (needs a two-sided quote on every leg;
 *  only ~1 in 6 after-hours logs has it — ~5% of the whole board and NONE of the settled book yet,
 *  which predates the capture). The measured, per-play version of the modeled cost curve. */
export function spreadCostPct(rec: { entryCredit: number; entryCreditCrossed?: number | null }): number | null {
  if (rec.entryCreditCrossed == null || !(Math.abs(rec.entryCredit) > 0)) return null;
  return (rec.entryCredit - rec.entryCreditCrossed) / Math.abs(rec.entryCredit);
}

/** Best available liquidity read: the market-hours re-measure when we have it (fresh two-sided
 *  quotes), else the log-time after-hours spread. This is what every liquidity surface should use. */
export function effectiveSpreadPct(rec: { entryCredit: number; entryCreditCrossed?: number | null; liveSpreadPct?: number | null }): number | null {
  if (rec.liveSpreadPct != null) return rec.liveSpreadPct;
  return spreadCostPct(rec);
}

export type LiquidityTier = "tight" | "wide" | "unknown";
type LiqRec = { entryCredit: number; entryCreditCrossed?: number | null; liveSpreadPct?: number | null };

/** Route-capital-to-tradeable-chains bucket: 'tight' = crossing eats < WIDE_SPREAD_PCT of the mid
 *  credit (a fill near mid is realistic), 'wide' = the credit won't survive a market fill, 'unknown'
 *  = no two-sided quote captured (after hours OR the market-hours pass hasn't run). Ordering key. */
export function liquidityTier(rec: LiqRec): LiquidityTier {
  const sc = effectiveSpreadPct(rec);
  if (sc == null) return "unknown";
  return sc >= WIDE_SPREAD_PCT ? "wide" : "tight";
}

/** Sort rank for "tradeable first": tight chains (by ascending spread cost) → unknown → wide. Lower
 *  sorts first. A rich sell play in a tight chain is where the edge is actually collectable. */
export function tradeabilityRank(rec: LiqRec): number {
  const tier = liquidityTier(rec);
  const sc = effectiveSpreadPct(rec);
  if (tier === "tight") return sc ?? 0; // 0..<0.5, tightest first
  if (tier === "unknown") return 1; // no read — after the known-tight, before the known-wide
  return 2 + (sc ?? 0); // wide, widest last
}

/**
 * Context chips stamped at LOG time. Honesty contract, same as catalystFlag above: these ANNOTATE,
 * they never gate — the play still logs and grades, so the record can measure whether each flag
 * actually predicts anything once the sample is real. The 2026-08-05 retro (206 sells, 12 tails)
 * found only thin-credit defensible; wide-gap/undefined-risk/hist-max are the candidates being
 * accumulated for the rematch.
 */
export function computeRiskFlags(r: {
  verdict: "rich" | "cheap";
  entryCredit: number;
  entryCreditCrossed?: number | null;
  liveSpreadPct?: number | null;
  spotAtRec: number;
  maxLoss: number | null;
  gapDays?: number | null;
  impliedMovePct: number;
  histMaxPct?: number | null;
  catalystFlag?: unknown | null;
}): string[] {
  const flags: string[] = [];
  if (r.verdict === "rich" && r.spotAtRec > 0 && r.entryCredit / r.spotAtRec < THIN_CREDIT_PCT) flags.push("thin-credit");
  const sc = effectiveSpreadPct(r);
  if (sc != null && sc >= WIDE_SPREAD_PCT) flags.push("wide-spread");
  if (r.maxLoss == null) flags.push("undefined-risk");
  if (r.gapDays != null && r.gapDays >= 5) flags.push("wide-gap");
  if (r.verdict === "rich" && r.histMaxPct != null && r.histMaxPct > r.impliedMovePct) flags.push("implied<hist-max");
  if (r.catalystFlag) flags.push("catalyst");
  return flags;
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

/**
 * Pre-print drift breach: the underlying drifted past the implied move BEFORE the print, so the
 * short strikes were already breached going into the event. `ratio` = |drift| / implied.
 *
 * ⚠ INFORMATIONAL ONLY — deliberately NOT a suppression gate. A chronological walk-forward split
 * (2026-08-10) showed this does NOT reliably predict P&L: of the 9 in-sample breaches 4 WON, and
 * the −$17k the rule "catches" is almost entirely ONE name (ATKR, drift +31.8% vs 12.8% implied).
 * Remove ATKR and the bucket is a −$2k wash. Gating on it would be the hurricane-composite overfit
 * repeated. So it renders as a risk-context chip — "your short is breached going in" is true and
 * worth seeing — but the play still logs and grades, and nothing is hidden on its account.
 */
export function driftBreach(rec: TradeRec): { ratio: number; breached: boolean } | null {
  if (rec.driftMovePct == null || !(rec.impliedMovePct > 0)) return null;
  const ratio = Math.abs(rec.driftMovePct) / rec.impliedMovePct;
  return { ratio: +ratio.toFixed(2), breached: ratio >= 1 };
}

/**
 * Execution-cost model: crossing the spread forfeits `crossFrac` of the entry credit on EVERY play
 * (a short fills below mid), applied to the $100k-notional dollar P&L. The mid-price record is the
 * CEILING, not the expectation — the first-night capture measured the gap at ~45% of the mid
 * credit, at which the whole sell book's edge shrinks ~6× and by ~60% it goes negative. This is the
 * real scaling constraint, so the board shows the curve rather than one flattering number.
 */
export function costAdjustedDollarPnl(rec: TradeRec, crossFrac: number, notional = PLAY_NOTIONAL): number | null {
  const base = dollarPnl(rec.pnl as number, rec.spotAtRec, notional);
  if (base == null) return null;
  const shares = notional / rec.spotAtRec;
  return base - crossFrac * Math.abs(rec.entryCredit) * shares;
}

export interface CostPoint { crossPct: number; total: number; avgPnl: number; winRate: number; n: number }

/** The SELL book's settled P&L across modeled crossing fractions — the "can we scale it" curve. */
export function costCurve(recs: TradeRec[], fractions = [0, 0.25, 0.45, 0.6], notional = PLAY_NOTIONAL): CostPoint[] {
  const sells = recs.filter((r) => r.status === "settled" && r.pnl != null && r.verdict === "rich");
  return fractions.map((f) => {
    const ds = sells.map((r) => costAdjustedDollarPnl(r, f, notional)).filter((x): x is number => x != null);
    const total = ds.reduce((a, b) => a + b, 0);
    return { crossPct: Math.round(f * 100), total, avgPnl: ds.length ? total / ds.length : 0, winRate: ds.length ? ds.filter((x) => x > 0).length / ds.length : 0, n: ds.length };
  });
}
