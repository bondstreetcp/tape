import { test } from "node:test";
import assert from "node:assert/strict";
import { returnAttribution, factorBetas, activeFactorExposure, type AlignedReturns } from "../lib/portfolioRisk";

// Synthetic world with a known factor structure so we can assert additivity + loadings.
const N = 120;
const dates = Array.from({ length: N }, (_, t) => t + 1);
const market = Array.from({ length: N }, (_, t) => 0.0005 + 0.001 * Math.sin(t / 5)); // positive drift + wiggle
const mk = (f: (t: number) => number) => Array.from({ length: N }, (_, t) => f(t));
const SPY = market.slice(); // SPY ≈ market
const IWM = mk((t) => market[t] + 0.0008 * Math.sin(t / 3)); // Size = IWM − SPY
const IWF = mk((t) => market[t] + 0.0006 * Math.cos(t / 4));
const IWD = mk((t) => market[t] + 0.0006 * Math.sin(t / 4)); // Value = IWD − IWF
const MTUM = mk((t) => market[t] + 0.0007 * Math.sin(t / 6)); // Momentum = MTUM − market
const QUAL = mk((t) => market[t] + 0.0005 * Math.cos(t / 5));
const USMV = mk((t) => market[t] + 0.0004 * Math.sin(t / 7));
const aligned: AlignedReturns = {
  dates,
  market,
  returns: { AAA: market.slice(), BBB: MTUM.slice() }, // AAA is pure market; BBB = market + momentum
  extra: { SPY, IWM, IWF, IWD, MTUM, QUAL, USMV },
};
const BASE = 100_000;

test("returnAttribution: additive, market-dominated for a pure-market book", () => {
  const a = returnAttribution([{ symbol: "AAA", value: BASE }], aligned, BASE, 120)!;
  // additive by construction: total = Σ factor contributions + specific
  assert.ok(Math.abs(a.totalRet - (a.factors.reduce((s, f) => s + f.ret, 0) + a.specific)) < 1e-12);
  // AAA at weight 1 → book return IS the market return
  assert.ok(Math.abs(a.totalRet - market.reduce((s, x) => s + x, 0)) < 1e-9);
  // Market is the largest contribution; near-perfect daily fit (rBook == the Market factor)
  const byAbs = [...a.factors].sort((x, y) => Math.abs(y.ret) - Math.abs(x.ret));
  assert.equal(byAbs[0].factor, "Market");
  assert.ok(a.r2 > 0.95);
});

test("returnAttribution: additive + high fit for a two-factor (market+momentum) book", () => {
  const b = returnAttribution([{ symbol: "BBB", value: BASE }], aligned, BASE, 120)!;
  assert.ok(Math.abs(b.totalRet - (b.factors.reduce((s, f) => s + f.ret, 0) + b.specific)) < 1e-12);
  assert.ok(b.r2 > 0.9); // BBB == market + momentum spread exactly → factors explain nearly all of it
});

test("factorBetas: pure-market book loads ~1 on Market, ~0 elsewhere", () => {
  const fb = factorBetas([{ symbol: "AAA", value: BASE }], aligned, BASE)!;
  const beta = (f: string) => fb.exposures.find((e) => e.factor === f)!.beta;
  assert.ok(Math.abs(beta("Market") - 1) < 0.15); // ridge shrinks a touch
  assert.ok(Math.abs(beta("Momentum")) < 0.2);
  assert.ok(fb.r2 > 0.95);
});

test("activeFactorExposure: book == benchmark → all active loadings ~0", () => {
  const ae = activeFactorExposure([{ symbol: "AAA", value: BASE }], aligned, "SPY", BASE, 120)!;
  for (const e of ae.exposures) assert.ok(Math.abs(e.beta) < 1e-6);
});

test("returnAttribution: null without a market/factor series", () => {
  assert.equal(returnAttribution([{ symbol: "AAA", value: BASE }], { dates, returns: aligned.returns }, BASE, 120), null);
});
