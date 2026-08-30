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
