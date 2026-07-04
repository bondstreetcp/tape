/**
 * Dealer gamma exposure (GEX) — the "naive" market-maker gamma model used by SpotGamma & co. Pure and
 * client-safe; the route solves each contract's IV and hands us clean GammaContract[].
 *
 * Convention (the standard heuristic, stated plainly so it's not mistaken for fact): dealers are assumed
 * LONG call gamma and SHORT put gamma — i.e. customers overwrite calls (dealer long) and buy puts for
 * protection (dealer short). So a call's gamma counts +, a put's counts −.
 *
 *   GEX_$(contract) = Γ · OI · 100 · S² · 0.01 · (call ? +1 : −1)
 *
 * = the DOLLARS of delta a dealer must trade to stay hedged for a 1% move in spot. Net GEX > 0 → dealers
 * are long gamma: they buy dips / sell rips → they DAMPEN and pin realized vol. Net GEX < 0 → dealers are
 * short gamma: they sell dips / buy rips → they AMPLIFY moves. The "gamma flip" is the spot level where
 * net GEX crosses zero — below it you're in the short-gamma (unstable) regime.
 *
 * This is a positioning heuristic, not gospel: the dealer long/short assumption is a convention, OI is
 * end-of-day, and real dealer books net across expiries and venues. Decision support, not a signal.
 */
import { bsGreeks } from "./blackScholes";

const MULT = 100; // shares per option contract

export interface GammaContract {
  kind: "call" | "put";
  strike: number;
  T: number; // years to expiry
  sig: number; // solved implied vol (decimal)
  oi: number;
}
export interface GammaStrike {
  strike: number;
  gex: number; // net $ dealer gamma per 1% move at this strike
  callOI: number;
  putOI: number;
}
export interface GammaExposure {
  spot: number;
  totalGex: number; // net $ dealer gamma per 1% move (signed)
  grossGex: number; // Σ|gex| — total gamma to be hedged per 1% move
  flip: number | null; // gamma-flip / zero-gamma spot level (nearest to spot)
  pcRatio: number | null; // put OI ÷ call OI
  callWall: { strike: number; oi: number } | null; // largest call-OI strike (upside pin / resistance)
  putWall: { strike: number; oi: number } | null; // largest put-OI strike (downside pin / support)
  strikes: GammaStrike[]; // per-strike GEX, trimmed to a moneyness band for the chart
}

// GEX ($ per 1% move) for one contract at a hypothetical spot S.
function contractGex(c: GammaContract, S: number): number {
  const g = bsGreeks(c.kind, S, c.strike, c.T, c.sig);
  if (!g) return 0;
  return g.gamma * c.oi * MULT * S * S * 0.01 * (c.kind === "call" ? 1 : -1);
}

function totalGexAt(contracts: GammaContract[], S: number): number {
  let t = 0;
  for (const c of contracts) t += contractGex(c, S);
  return t;
}

// The spot level where net GEX crosses zero, nearest to the current spot. Scans a ±30% band and picks the
// zero-crossing closest to spot (a book can have several; the one by spot is the regime boundary that bites).
function gammaFlip(contracts: GammaContract[], S: number): number | null {
  const lo = 0.7 * S,
    hi = 1.3 * S,
    steps = 60;
  let prevS = lo,
    prev = totalGexAt(contracts, lo);
  let best: number | null = null,
    bestDist = Infinity;
  for (let i = 1; i <= steps; i++) {
    const Sp = lo + (hi - lo) * (i / steps);
    const cur = totalGexAt(contracts, Sp);
    if (Number.isFinite(prev) && Number.isFinite(cur) && prev !== cur && prev < 0 !== cur < 0) {
      const t = prev / (prev - cur); // linear interpolation of the crossing
      const cross = prevS + (Sp - prevS) * t;
      const dist = Math.abs(cross - S);
      if (dist < bestDist) {
        bestDist = dist;
        best = cross;
      }
    }
    prevS = Sp;
    prev = cur;
  }
  return best;
}

export function computeGamma(contracts: GammaContract[], S: number, band = 0.25): GammaExposure | null {
  if (!(S > 0) || !contracts.length) return null;
  const byStrike = new Map<number, GammaStrike>();
  let totCallOI = 0,
    totPutOI = 0,
    totalGex = 0,
    grossGex = 0;
  for (const c of contracts) {
    if (!(c.oi > 0)) continue;
    const gex = contractGex(c, S);
    totalGex += gex;
    grossGex += Math.abs(gex);
    const e = byStrike.get(c.strike) || { strike: c.strike, gex: 0, callOI: 0, putOI: 0 };
    e.gex += gex;
    if (c.kind === "call") {
      e.callOI += c.oi;
      totCallOI += c.oi;
    } else {
      e.putOI += c.oi;
      totPutOI += c.oi;
    }
    byStrike.set(c.strike, e);
  }
  if (!byStrike.size) return null;
  const strikes = [...byStrike.values()].sort((a, b) => a.strike - b.strike);
  const callWall = strikes.reduce<GammaStrike | null>((m, x) => (!m || x.callOI > m.callOI ? x : m), null);
  const putWall = strikes.reduce<GammaStrike | null>((m, x) => (!m || x.putOI > m.putOI ? x : m), null);
  return {
    spot: S,
    totalGex,
    grossGex,
    flip: gammaFlip(contracts, S),
    pcRatio: totCallOI > 0 ? totPutOI / totCallOI : null,
    callWall: callWall && callWall.callOI > 0 ? { strike: callWall.strike, oi: callWall.callOI } : null,
    putWall: putWall && putWall.putOI > 0 ? { strike: putWall.strike, oi: putWall.putOI } : null,
    strikes: strikes.filter((x) => Math.abs(Math.log(x.strike / S)) <= band),
  };
}
