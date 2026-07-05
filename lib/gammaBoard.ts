/**
 * Dealer Gamma Board — the universe-wide view of the per-name GEX model (lib/gammaExposure.ts). For each
 * scanned name we store the net/gross dealer gamma, the zero-gamma flip level + how far spot sits from it,
 * the put/call OI ratio, and the OI walls. Pure types + derivations so the row assembly is unit-tested and
 * shared by the nightly script + the view. Doctrine: code computes the positioning read, no LLM.
 *
 * Reading it: totalGex < 0 = dealers SHORT gamma → they chase price → moves AMPLIFIED (trend/breakout risk).
 * totalGex > 0 = dealers LONG gamma → they fade price → moves DAMPENED / pinned (mean-reversion, low RV).
 * distToFlipPct near 0 = spot sits on the regime boundary — a small move flips dealer hedging (explosive).
 */

export interface GammaBoardRow {
  symbol: string;
  name: string;
  sector: string;
  spot: number;
  totalGex: number; // net $ dealer gamma per 1% move (signed)
  grossGex: number; // Σ|gex| — total gamma to hedge per 1% move (positioning magnitude)
  flip: number | null; // zero-gamma spot level
  distToFlipPct: number | null; // (spot − flip)/spot·100; >0 = spot above flip (long-gamma side), <0 = below
  regime: "long" | "short"; // sign of net dealer gamma
  pcRatio: number | null; // put OI ÷ call OI
  callWall: { strike: number; oi: number } | null; // largest call-OI strike (upside pin / resistance)
  putWall: { strike: number; oi: number } | null; // largest put-OI strike (downside pin / support)
  expiries: number; // # of expiries that contributed
}

export interface GammaBoardData {
  generatedAt: string;
  universe: string;
  scanned: number; // names attempted
  rows: GammaBoardRow[];
}

/** Signed distance of spot from the gamma-flip level, in % of spot. null if no flip. */
export function distToFlipPct(spot: number, flip: number | null): number | null {
  if (flip == null || !(spot > 0)) return null;
  return ((spot - flip) / spot) * 100;
}

/** Assemble a board row from a name's computed GEX + identity, deriving the flip distance + regime. */
export function buildGammaRow(input: {
  symbol: string;
  name: string;
  sector: string;
  spot: number;
  totalGex: number;
  grossGex: number;
  flip: number | null;
  pcRatio: number | null;
  callWall: { strike: number; oi: number } | null;
  putWall: { strike: number; oi: number } | null;
  expiries: number;
}): GammaBoardRow {
  return {
    ...input,
    distToFlipPct: distToFlipPct(input.spot, input.flip),
    regime: input.totalGex >= 0 ? "long" : "short",
  };
}

/** Spot sits within `pct`% of the gamma-flip level — a small move flips the dealer-hedging regime. */
export function nearFlip(row: Pick<GammaBoardRow, "distToFlipPct">, pct = 3): boolean {
  return row.distToFlipPct != null && Math.abs(row.distToFlipPct) <= pct;
}

export type GammaSort = "gross" | "short" | "long" | "flip" | "pcHigh" | "pcLow";

/** Rank rows for a chosen lens. `gross` (default) = biggest positioning; `short` = most-amplified;
 *  `flip` = nearest the regime boundary; `pcHigh/Low` = most put-/call-heavy. */
export function rankGammaBoard(rows: GammaBoardRow[], sort: GammaSort = "gross"): GammaBoardRow[] {
  const r = [...rows];
  switch (sort) {
    case "short": return r.sort((a, b) => a.totalGex - b.totalGex); // most negative first
    case "long": return r.sort((a, b) => b.totalGex - a.totalGex);
    case "flip": return r.sort((a, b) => Math.abs(a.distToFlipPct ?? 1e9) - Math.abs(b.distToFlipPct ?? 1e9));
    case "pcHigh": return r.sort((a, b) => (b.pcRatio ?? -1) - (a.pcRatio ?? -1));
    case "pcLow": return r.sort((a, b) => (a.pcRatio ?? 1e9) - (b.pcRatio ?? 1e9));
    default: return r.sort((a, b) => b.grossGex - a.grossGex);
  }
}
