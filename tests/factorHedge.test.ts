import { test } from "node:test";
import assert from "node:assert/strict";
import { optimizeHedge } from "../lib/hedgeOptimizer";
import type { AlignedReturns } from "../lib/portfolioRisk";

// Synthetic world: market + an independent momentum spread, with MTUM in the hedge menu so momentum is
// actually hedgeable. Book X loads +1 on both market and momentum.
const N = 150;
const dates = Array.from({ length: N }, (_, t) => t + 1);
const market = Array.from({ length: N }, (_, t) => 0.001 * Math.sin(t / 5));
const mom = Array.from({ length: N }, (_, t) => 0.002 * Math.sin(t / 6)); // momentum spread (≈ orthogonal to market)
const mk = (f: (t: number) => number) => Array.from({ length: N }, (_, t) => f(t));
const SPY = market.slice();
const IWM = mk((t) => market[t] + 0.0009 * Math.sin(t / 3));
const IWF = mk((t) => market[t] + 0.0007 * Math.cos(t / 4));
const IWD = mk((t) => market[t] + 0.0007 * Math.sin(t / 4));
const MTUM = mk((t) => market[t] + mom[t]); // MTUM − market = mom
const QUAL = mk((t) => market[t] + 0.0005 * Math.cos(t / 5));
const USMV = mk((t) => market[t] + 0.0004 * Math.sin(t / 7));
const etf = { SPY, IWM, IWF, IWD, MTUM, QUAL, USMV };
const VALUE = 100_000;
const aligned: AlignedReturns = { dates, market, returns: { X: mk((t) => market[t] + mom[t]) }, extra: etf };

// beta of a $ P&L series to a factor vector f: Cov(P,f)/Var(f).
function betaTo(P: number[], f: number[]): number {
  const mp = P.reduce((a, x) => a + x, 0) / P.length;
  const mf = f.reduce((a, x) => a + x, 0) / f.length;
  let cov = 0, vf = 0;
  for (let t = 0; t < P.length; t++) { cov += (P[t] - mp) * (f[t] - mf); vf += (f[t] - mf) * (f[t] - mf); }
  return cov / vf;
}
const bookPnl = mk((t) => VALUE * (market[t] + mom[t]));
const hedgedPnl = (legs: { etf: string; notional: number }[]) =>
  bookPnl.map((p, t) => p + legs.reduce((a, l) => a + l.notional * (etf as Record<string, number[]>)[l.etf][t], 0));

test("factor hedge: neutralizing Momentum pins the hedged book's momentum beta to ~0", () => {
  const before = betaTo(bookPnl, mom);
  assert.ok(Math.abs(before) > 0.5 * VALUE); // book is genuinely momentum-exposed (~1× value)
  const res = optimizeHedge([{ symbol: "X", value: VALUE }], aligned, etf, { neutralizeFactors: ["Momentum"], ridge: 0.02 })!;
  assert.ok(res.neutralized.includes("Momentum"));
  assert.equal(res.marketNeutral, false); // we did NOT ask for market-neutral
  const after = betaTo(hedgedPnl(res.legs), mom);
  assert.ok(Math.abs(after) < 1e-3 * Math.abs(before)); // KKT equality → momentum beta ≈ 0
});

test("factor hedge: Market + Momentum together flattens both betas", () => {
  const res = optimizeHedge([{ symbol: "X", value: VALUE }], aligned, etf, { marketNeutral: true, neutralizeFactors: ["Momentum"], ridge: 0.02 })!;
  assert.deepEqual([...res.neutralized].sort(), ["Market", "Momentum"]);
  assert.ok(res.marketNeutral);
  // The exact KKT solution zeroes both; the DISPLAYED legs drop sub-0.5%-turnover entries, so allow a small
  // residual — still a ≥95% cut in each beta ("flattened").
  const P = hedgedPnl(res.legs);
  assert.ok(Math.abs(betaTo(P, market)) < 0.05 * Math.abs(betaTo(bookPnl, market)));
  assert.ok(Math.abs(betaTo(P, mom)) < 0.05 * Math.abs(betaTo(bookPnl, mom)));
});

test("factor hedge: unconstrained solve reports no neutralized factors", () => {
  const res = optimizeHedge([{ symbol: "X", value: VALUE }], aligned, etf, { ridge: 0.02 })!;
  assert.deepEqual(res.neutralized, []);
  assert.equal(res.marketNeutral, false);
});
