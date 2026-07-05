import { test } from "node:test";
import assert from "node:assert/strict";
import { ols, correlation, hedgeRatio, spreadSeries, zScore, halfLife, alignLogPrices, evalPair, findPairs, type Daily } from "../lib/pairs";

const approx = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} (±${tol})`);

test("ols: recovers a known line y = 3x + 2", () => {
  const x = [0, 1, 2, 3, 4], y = x.map((v) => 3 * v + 2);
  const { slope, intercept } = ols(x, y);
  approx(slope, 3); approx(intercept, 2);
});

test("ols: constant x → slope 0, intercept mean(y)", () => {
  const r = ols([5, 5, 5], [1, 2, 3]);
  approx(r.slope, 0); approx(r.intercept, 2);
});

test("correlation: identical → 1, negated → -1, constant → 0", () => {
  const x = [1, 2, 3, 4, 5];
  approx(correlation(x, x), 1);
  approx(correlation(x, x.map((v) => -v)), -1);
  assert.equal(correlation(x, [7, 7, 7, 7, 7]), 0);
});

test("hedgeRatio + spread: logA = 2·logB → beta 2, spread ≈ 0", () => {
  const logB = [0, 0.1, 0.2, 0.35, 0.4, 0.55];
  const logA = logB.map((v) => 2 * v);
  approx(hedgeRatio(logA, logB), 2);
  const s = spreadSeries(logA, logB, 2);
  for (const v of s) approx(v, 0, 1e-9);
});

test("zScore: last point vs the series mean/σ", () => {
  approx(zScore([1, 2, 3, 4, 5]), 2 / Math.sqrt(2.5), 1e-9); // (5-3)/std; sample std = √2.5 = 1.5811 → 1.2649
});

test("halfLife: AR(1) φ=0.9 decay → −ln2/(φ−1) ≈ 6.93; pure trend → null", () => {
  const ar: number[] = [10];
  for (let i = 1; i < 200; i++) ar.push(0.9 * ar[i - 1]); // s_t = 0.9 s_{t-1} → Δs = -0.1 s_{t-1}
  const hl = halfLife(ar);
  assert.ok(hl != null); approx(hl!, -Math.log(2) / -0.1, 1e-6); // ≈ 6.9315
  const trend = Array.from({ length: 200 }, (_, i) => i * 1.0); // Δs constant → slope 0 → not reverting
  assert.equal(halfLife(trend), null);
});

test("alignLogPrices: intersects on shared timestamps, drops non-positive", () => {
  const a: Daily = [[1, 10], [2, 20], [3, 30], [4, 40]];
  const b: Daily = [[2, 5], [3, 0], [4, 8], [5, 9]]; // t=3 has price 0 (dropped); t=1,5 unshared
  const { logA, logB } = alignLogPrices(a, b);
  assert.equal(logA.length, 2); // only t=2 and t=4 survive
  approx(logA[0], Math.log(20)); approx(logB[0], Math.log(5));
  approx(logA[1], Math.log(40)); approx(logB[1], Math.log(8));
});

test("evalPair + findPairs: recovers a cointegrated pair, filters an uncorrelated one", () => {
  // B: a wiggly uptrend (so returns have variance). A = 2·B (log) + a small mean-reverting spread.
  const N = 300;
  const logB = Array.from({ length: N }, (_, i) => 0.002 * i + 0.03 * Math.sin(i * 0.11));
  const spread = Array.from({ length: N }, (_, i) => 0.01 * Math.sin(i * 0.25)); // stationary, mean-reverting, small
  const logA = logB.map((v, i) => 2 * v + spread[i]);
  const mk = (logs: number[]): Daily => logs.map((v, i) => [i, Math.exp(v)]);
  const series = new Map<string, Daily>([["A", mk(logA)], ["B", mk(logB)], ["C", mk(Array.from({ length: N }, (_, i) => 0.05 * Math.sin(i * 0.9 + 1)))]]);

  const p = evalPair("A", "B", "Tech", logA, logB, 252)!;
  assert.ok(p, "pair evaluated");
  approx(p.beta, 2, 0.05); // hedge ratio ≈ 2
  assert.ok(p.corr > 0.9, `corr ${p.corr} > 0.9`); // both driven by logB
  assert.ok(p.halfLifeDays != null && p.halfLifeDays > 0, `half-life ${p.halfLifeDays}`);

  // findPairs: A/B is correlated + mean-reverting; C is unrelated → only A/B (if stretched) survives the filters.
  const pairs = findPairs(["A", "B", "C"], series, () => "Tech", () => 1, { minCorr: 0.7, minAbsZ: 0, minHalfLife: 0.1, maxHalfLife: 1000, minOverlap: 100 });
  const keys = pairs.map((x) => [x.a, x.b].sort().join("/"));
  assert.ok(keys.includes("A/B"), "A/B kept");
  assert.ok(!keys.includes("A/C") && !keys.includes("B/C"), "unrelated C dropped by corr filter");
});
