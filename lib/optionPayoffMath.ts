/**
 * CLIENT-SAFE pure math for an option position's payoff distribution at expiry.
 *
 * Probability-of-profit AND expected value under a lognormal for the underlying at the ATM implied vol
 * with ~zero drift (the same risk-neutral, r≈0 measure the strategy analyzer already used for POP). EV
 * integrates payoff·density; because each leg's premium embeds its OWN strike's IV while the density uses
 * a single ATM IV, EV isolates the vol-skew + structural edge — read it as "expected P/L if the stock
 * realizes ATM vol, with no directional drift". POP without EV misleads: a far-OTM short put can show a
 * 90% hit-rate yet a negative expectancy because the rare tail loss outweighs the frequent small win.
 */
export function lognormalPopEv(
  payoff: (S: number) => number, // position P/L (any consistent units) at underlying price S at expiry
  spot: number,
  sigmaAtm: number, // ATM implied vol, decimal (0.3 = 30%)
  dteDays: number,
): { pop: number | null; ev: number | null } {
  const T = dteDays / 365;
  if (!(spot > 0) || !(sigmaAtm > 0) || !(T > 0)) return { pop: null, ev: null };
  const sd = sigmaAtm * Math.sqrt(T);
  const mu = Math.log(spot) - 0.5 * sigmaAtm * sigmaAtm * T; // median-preserving zero drift
  const N = 600, Slo = spot * 0.1, Shi = spot * 5, dS = (Shi - Slo) / N;
  const SQRT2PI = 2.5066282746310002;
  let inP = 0, tot = 0, evAcc = 0;
  for (let i = 0; i < N; i++) {
    const S = Slo + (i + 0.5) * dS;
    const z = (Math.log(S) - mu) / sd;
    const w = (Math.exp(-0.5 * z * z) / (S * sd * SQRT2PI)) * dS; // lognormal density × dS
    const p = payoff(S);
    tot += w;
    evAcc += p * w;
    if (p > 0) inP += w;
  }
  return tot > 0 ? { pop: inP / tot, ev: evAcc / tot } : { pop: null, ev: null };
}

/**
 * POP + EV of a payoff against the MARKET's own risk-neutral density (from the fitted smile /
 * Breeden–Litzenberger, `/api/iv-surface`) rather than a symmetric lognormal — so it's SKEW-AWARE: the
 * fat left tail equities price in lowers a put-seller's EV, richer put skew raises the credit's edge.
 * `density` is [price, density] points ascending in price (a DistExp.pts). Trapezoid-integrated and
 * normalized (the tails are truncated), so it needs no separate normalization from the caller.
 */
export function densityPopEv(payoff: (S: number) => number, density: [number, number][]): { pop: number | null; ev: number | null } {
  if (!density || density.length < 3) return { pop: null, ev: null };
  let tot = 0, evAcc = 0, profitMass = 0;
  for (let i = 1; i < density.length; i++) {
    const [x0, d0] = density[i - 1];
    const [x1, d1] = density[i];
    const dx = x1 - x0;
    if (!(dx > 0)) continue;
    const area = ((d0 + d1) / 2) * dx; // trapezoid mass on the segment
    const p = payoff((x0 + x1) / 2); // payoff at the segment midpoint
    tot += area;
    evAcc += p * area;
    if (p > 0) profitMass += area;
  }
  return tot > 0 ? { pop: profitMass / tot, ev: evAcc / tot } : { pop: null, ev: null };
}
