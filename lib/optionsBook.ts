/**
 * Options support for Prism — parse option legs out of the pasted book, price them, and turn them into
 * (a) delta-equivalent share exposure that flows through the EXISTING linear engine (exposure, factor
 * attribution, VaR, hedge) and (b) a book-level greeks read, and (c) non-linear scenario repricing so a
 * protective put's convexity actually shows up in a crash.
 *
 * Pricing/greeks come from lib/blackScholes (the app's shared client-safe pricer) — no second pricer.
 * IV: options rarely come with a quote in a pasted book, so we price off an IV estimate the caller
 * supplies (Prism passes each name's realized vol from the vol cone as a proxy, overridable per leg).
 *
 * Syntax (one leg per line, alongside plain `SYMBOL SHARES` rows):
 *   AAPL C250 2026-01-16 x10      → long 10 Jan-16-2026 250 calls
 *   AAPL P200 2026-01-16 x-5      → short 5 puts (negative = written)
 *   AAPL C250 2026-01-16 x10 @12.40   → optional premium paid (backs out the leg's own IV)
 *
 * Pure + fs-free → unit-tested (tests/optionsBook.test.ts). Doctrine: code computes the stat, no LLM.
 */

import { bsPrice, bsGreeks, ivFromPrice } from "./blackScholes";

export const CONTRACT_MULTIPLIER = 100; // US equity options: 1 contract = 100 shares
const MS_PER_YEAR = 365 * 24 * 3600 * 1000;

export interface OptionLeg {
  symbol: string; // underlying, uppercase
  kind: "call" | "put";
  strike: number;
  expiry: string; // YYYY-MM-DD
  contracts: number; // signed; negative = short/written
  premium?: number; // optional per-share premium paid/received → backs out this leg's IV
}

/** One line of the book: either plain shares or an option leg. */
export type BookLine = { type: "shares"; symbol: string; shares: number } | { type: "option"; leg: OptionLeg };

// AAPL C250 2026-01-16 x10 [@12.40]   (case-insensitive; strike may be decimal)
const OPT_RE = /^([A-Za-z][A-Za-z.\-]*)\s+([CP])\s*(\d+(?:\.\d+)?)\s+(\d{4}-\d{2}-\d{2})\s+x\s*(-?\d+(?:\.\d+)?)\s*(?:@\s*(\d+(?:\.\d+)?))?$/i;

/** Parse one line as an option leg; null if it isn't one (caller falls back to the shares parser). */
export function parseOptionLine(line: string): OptionLeg | null {
  const m = OPT_RE.exec(line.trim());
  if (!m) return null;
  const [, sym, cp, strike, expiry, qty, prem] = m;
  const contracts = Number(qty);
  const k = Number(strike);
  if (!contracts || !(k > 0)) return null; // x0 is not a position
  const d = new Date(`${expiry}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return null;
  return {
    symbol: sym.toUpperCase(),
    kind: cp.toUpperCase() === "C" ? "call" : "put",
    strike: k,
    expiry,
    contracts,
    ...(prem != null ? { premium: Number(prem) } : {}),
  };
}

/**
 * Split a pasted book into option legs and the remaining (share) text. Option lines are removed from the
 * text so the caller can hand what's left to parsePositions untouched — the two parsers never see each
 * other's lines. Blank/comment lines pass through.
 */
export function splitBook(text: string): { legs: OptionLeg[]; sharesText: string } {
  const legs: OptionLeg[] = [];
  const rest: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const leg = parseOptionLine(raw);
    if (leg) legs.push(leg);
    else rest.push(raw);
  }
  return { legs, sharesText: rest.join("\n") };
}

/** Years from `now` to the leg's expiry (0 if expired). Caller passes `now` — keeps this deterministic. */
export function timeToExpiry(expiry: string, now: number): number {
  const t = new Date(`${expiry}T21:00:00Z`).getTime(); // ~US market close on expiry day
  return Number.isNaN(t) ? 0 : Math.max(0, (t - now) / MS_PER_YEAR);
}

export interface PricedLeg {
  leg: OptionLeg;
  spot: number;
  iv: number; // the vol used (from the leg's premium if given, else the caller's estimate)
  ivFromPremium: boolean;
  T: number; // years to expiry
  price: number; // per share
  marketValue: number; // signed $ (price × contracts × 100)
  deltaShares: number; // delta-equivalent SHARES of the underlying (signed)
  deltaDollar: number; // deltaShares × spot
  gammaDollar: number; // $ change in deltaDollar per +1% move in the underlying
  vegaDollar: number; // $ per +1 vol point
  thetaDollar: number; // $ per calendar day (negative = decay against you)
}

/**
 * Price one leg. `spot` is the underlying's last price; `ivEstimate` the fallback vol (Prism passes the
 * name's realized vol). Returns null if we can't price it (no spot, or no vol to work with).
 */
export function priceLeg(leg: OptionLeg, spot: number, ivEstimate: number | null, now: number): PricedLeg | null {
  if (!(spot > 0)) return null;
  const T = timeToExpiry(leg.expiry, now);
  // Prefer the vol implied by an actual premium; else the caller's estimate.
  const solved = leg.premium != null ? ivFromPrice(leg.kind, spot, leg.strike, T, leg.premium) : null;
  const iv = solved ?? (ivEstimate != null && ivEstimate > 0 ? ivEstimate : null);
  if (iv == null) return null;

  const qty = leg.contracts * CONTRACT_MULTIPLIER; // signed shares-equivalent scale
  const price = bsPrice(leg.kind, spot, leg.strike, T, iv);
  const g = bsGreeks(leg.kind, spot, leg.strike, T, iv);
  // At/after expiry bsGreeks returns null — fall back to the step delta of intrinsic value.
  const delta = g ? g.delta : leg.kind === "call" ? (spot > leg.strike ? 1 : 0) : spot < leg.strike ? -1 : 0;
  const deltaShares = delta * qty;
  return {
    leg,
    spot,
    iv,
    ivFromPremium: solved != null,
    T,
    price,
    marketValue: price * qty,
    deltaShares,
    deltaDollar: deltaShares * spot,
    // gamma is Δdelta per $1; ×spot×1% gives the delta-$ change per 1% move.
    gammaDollar: (g?.gamma ?? 0) * qty * spot * (spot * 0.01),
    vegaDollar: (g?.vega ?? 0) * qty,
    thetaDollar: (g?.theta ?? 0) * qty,
  };
}

export interface OptionsSummary {
  legs: PricedLeg[];
  unpriced: OptionLeg[]; // legs we couldn't price (no spot / no vol)
  marketValue: number; // net $ value of the options book (long premium positive)
  deltaDollar: number; // net delta exposure in $
  gammaDollar: number; // net $ delta change per 1% underlying move
  vegaDollar: number; // net $ per vol point
  thetaDollar: number; // net $ per day
  netContracts: number;
}

/** Price every leg and aggregate the book-level greeks. */
export function summarizeOptions(
  legs: OptionLeg[],
  spotOf: (sym: string) => number | null,
  ivOf: (sym: string) => number | null,
  now: number,
): OptionsSummary {
  const priced: PricedLeg[] = [];
  const unpriced: OptionLeg[] = [];
  for (const leg of legs) {
    const p = priceLeg(leg, spotOf(leg.symbol) ?? 0, ivOf(leg.symbol), now);
    if (p) priced.push(p); else unpriced.push(leg);
  }
  const sum = (f: (p: PricedLeg) => number) => priced.reduce((a, p) => a + f(p), 0);
  return {
    legs: priced,
    unpriced,
    marketValue: sum((p) => p.marketValue),
    deltaDollar: sum((p) => p.deltaDollar),
    gammaDollar: sum((p) => p.gammaDollar),
    vegaDollar: sum((p) => p.vegaDollar),
    thetaDollar: sum((p) => p.thetaDollar),
    netContracts: priced.reduce((a, p) => a + p.leg.contracts, 0),
  };
}

/**
 * Delta-equivalent SHARES per underlying — the bridge into the existing linear engine. Merging these into
 * the share positions makes options show up in exposure, sector tilts, factor attribution, VaR and the
 * hedge with no changes to any of those.
 */
export function deltaEquivalentShares(legs: PricedLeg[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of legs) out.set(p.leg.symbol, (out.get(p.leg.symbol) ?? 0) + p.deltaShares);
  return out;
}

/**
 * Non-linear scenario: reprice every leg with its underlying shocked and vol shocked by `volShockPoints`
 * VOL POINTS (a selloff raises IV — Prism passes a positive number for down moves), holding time fixed.
 *
 * `move` is either a flat underlying move (−0.10) or a per-symbol function. The per-symbol form matters
 * for the market-shock scenario: the cockpit's scenarioPnL propagates a MARKET move through each name's
 * beta (value·β·move), so options must be shocked by that same beta-adjusted move — otherwise `convexity`
 * (which the caller ADDS to the linear scenario) would be measured against the wrong baseline.
 *
 * Returns the options book's true P&L, what a delta-only model predicts, and the difference — the
 * convexity a linear model misses (a protective put's crash payoff, a short strangle's blow-up risk).
 */
export function scenarioOptionsPnl(
  legs: PricedLeg[],
  move: number | ((symbol: string) => number),
  volShockPoints = 0,
): { pnl: number; linearPnl: number; convexity: number } {
  const moveOf = typeof move === "function" ? move : () => move;
  let pnl = 0, linearPnl = 0;
  for (const p of legs) {
    const m = moveOf(p.leg.symbol);
    if (!Number.isFinite(m)) continue;
    const qty = p.leg.contracts * CONTRACT_MULTIPLIER;
    const S2 = Math.max(0.01, p.spot * (1 + m));
    const iv2 = Math.max(0.01, p.iv + volShockPoints / 100);
    const price2 = bsPrice(p.leg.kind, S2, p.leg.strike, p.T, iv2);
    pnl += (price2 - p.price) * qty;
    linearPnl += p.deltaDollar * m; // what a delta-only model predicts
  }
  return { pnl, linearPnl, convexity: pnl - linearPnl };
}
