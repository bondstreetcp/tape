/**
 * Vol × Gamma fusion — "Coiled Springs". Joins the Dealer Gamma Board (lib/gammaBoard) with the Realized-Vol
 * Cone (lib/volCone) by symbol to surface the setup an options trader actually wants: a name that is
 * historically QUIET (realized vol near the bottom of its own cone → cheap optionality) AND sits in a dealer
 * positioning that will AMPLIFY the next move (short gamma, or spot right on the gamma flip). Cheap vol + a
 * hedging accelerant = a coiled spring. Pure + fs-free (unit-tested); the page joins the two feeds at load.
 *
 *   coiled  = RV percentile LOW (≤25) AND (dealers short gamma OR spot near the flip) → buy cheap optionality
 *   pinned  = RV LOW-ish (≤40) AND dealers LONG gamma, away from the flip → dampened / quiet → sell premium
 *   blown   = RV HIGH (≥75) AND dealers short gamma → already wild and being amplified (trend or violent revert)
 *
 * Doctrine: code computes the join + the score, no LLM.
 */
import type { GammaBoardRow } from "./gammaBoard";
import type { VolConeFeedRow } from "./volCone";

export type Setup = "coiled" | "pinned" | "blown" | "none";

export interface FusedRow {
  symbol: string;
  name: string;
  sector: string;
  spot: number;
  // gamma
  regime: "long" | "short";
  totalGex: number;
  grossGex: number;
  distToFlipPct: number | null;
  pcRatio: number | null;
  flip: number | null;
  callWall: { strike: number; oi: number } | null;
  putWall: { strike: number; oi: number } | null;
  // realized-vol cone
  cur20: number | null;
  pct20: number | null; // percentile of current RV in own history (LOW = coiled)
  termSlope: number | null;
  min20: number | null;
  med20: number | null;
  max20: number | null;
  // fusion
  setup: Setup;
  springScore: number | null; // higher = more coiled-spring; null if no cone data (e.g. an index ETF)
}

/** Spot sits within `pct`% of the gamma-flip level. */
export const nearFlipPct = (distToFlipPct: number | null, pct = 3): boolean =>
  distToFlipPct != null && Math.abs(distToFlipPct) <= pct;

/** Classify the vol×gamma setup. null pct20 (no cone) → "none". */
export function classifySetup(pct20: number | null, regime: "long" | "short", distToFlipPct: number | null): Setup {
  if (pct20 == null) return "none";
  const near = nearFlipPct(distToFlipPct, 3);
  if (pct20 <= 25 && (regime === "short" || near)) return "coiled"; // cheap vol + an accelerant
  if (pct20 >= 75 && regime === "short") return "blown"; // already wild + amplified
  if (pct20 <= 40 && regime === "long" && !nearFlipPct(distToFlipPct, 5)) return "pinned"; // quiet + dampened
  return "none";
}

/**
 * Coiled-spring score (0-150): coiled-ness (100 − RV percentile) + a short-gamma bonus + a flip-proximity
 * bonus. Transparent, not a black box. null when there's no cone data to anchor the coiled-ness.
 */
export function springScore(pct20: number | null, regime: "long" | "short", distToFlipPct: number | null): number | null {
  if (pct20 == null) return null;
  let s = 100 - pct20; // 100 when RV is at the bottom of its cone, 0 at the top
  if (regime === "short") s += 25; // dealers chase → moves amplified
  if (nearFlipPct(distToFlipPct, 3)) s += 25;
  else if (nearFlipPct(distToFlipPct, 6)) s += 12; // near the regime boundary
  return s;
}

/** Join gamma rows with cone rows (by symbol) → fused, classified, scored rows. Gamma is the driving set
 *  (US options names); a name with no cone row (e.g. SPY/QQQ) keeps null cone fields + setup "none". */
export function fuseVolGamma(gamma: GammaBoardRow[], cone: VolConeFeedRow[]): FusedRow[] {
  const coneBy = new Map(cone.map((c) => [c.symbol.toUpperCase(), c]));
  return gamma.map((g) => {
    const c = coneBy.get(g.symbol.toUpperCase());
    const pct20 = c?.pct20 ?? null;
    return {
      symbol: g.symbol, name: g.name, sector: g.sector, spot: g.spot,
      regime: g.regime, totalGex: g.totalGex, grossGex: g.grossGex, distToFlipPct: g.distToFlipPct,
      pcRatio: g.pcRatio, flip: g.flip, callWall: g.callWall, putWall: g.putWall,
      cur20: c?.cur20 ?? null, pct20, termSlope: c?.termSlope ?? null,
      min20: c?.min20 ?? null, med20: c?.med20 ?? null, max20: c?.max20 ?? null,
      setup: classifySetup(pct20, g.regime, g.distToFlipPct),
      springScore: springScore(pct20, g.regime, g.distToFlipPct),
    };
  });
}
