// CEF Discount Hunter — a curated, ranked opportunity list of the closed-end funds trading at the
// most STRETCHED discounts (cheap vs. their OWN history, not just a big absolute discount), with
// the yield you collect while waiting for the gap to close. Distinct from the full CEF screener
// (a browse/filter tool) — this is the scored shortlist. Pure compute off data/cef.json (no LLM).

import type { Cef } from "./cef";

export interface CefHunterName extends Cef {
  score: number;
  stretched: boolean; // z1y ≤ −1: unusually cheap vs its own 1-yr discount history
}

export function buildCefHunter(funds: Cef[]): CefHunterName[] {
  const cand = funds.filter(
    (f) => f.region === "US" && (f.mktCapM ?? 0) >= 50 && f.discount != null && f.discount <= -3 && f.z1y != null,
  );
  return cand
    .map((f) => {
      const depth = Math.min(-(f.discount as number), 30); // discount magnitude, capped
      const stretch = (f.z1y as number) < 0 ? Math.min(-(f.z1y as number), 3) : 0; // std-devs below its norm
      const yld = Math.min(f.distRate ?? 0, 15);
      const score = Math.round((depth * 0.5 + stretch * 6 + yld * 0.4) * 10) / 10;
      return { ...f, score, stretched: (f.z1y as number) <= -1 };
    })
    .sort((a, b) => b.score - a.score);
}
