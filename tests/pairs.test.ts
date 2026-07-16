import { test } from "node:test";
import assert from "node:assert/strict";
import { ols, correlation, hedgeRatio, spreadSeries, zScore, halfLife, alignLogPrices, evalPair, findPairs, scanPairs, type Daily } from "../lib/pairs";

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

// ── scanPairs (universe scanner: stretched + decoupled in one pass) ────────────────────────────────
const DAYMS = 86_400_000;
/** Daily [ts,px] from a return series (ts on a clean UTC-day grid so alignLogPrices matches). */
function fromReturns(rets: number[], p0 = 100): Daily {
  const out: Daily = [[0, p0]];
  let lp = Math.log(p0);
  for (let i = 0; i < rets.length; i++) { lp += rets[i]; out.push([(i + 1) * DAYMS, Math.exp(lp)]); }
  return out;
}

test("scanPairs: DECOUPLED — tight for a year, correlation collapses in the last month → flagged", () => {
  const N = 280;
  const rB: number[] = [], rA: number[] = [], rIndep: number[] = [];
  for (let i = 0; i < N; i++) {
    const b = 0.012 * Math.sin(i * 0.7);
    rB.push(b);
    // A tracks B for all but the last 21 days, then diverges onto an unrelated path (the break).
    rA.push(i < N - 21 ? b + 0.0008 * Math.sin(i * 13.1) : 0.013 * Math.cos(i * 2.3));
    rIndep.push(0.011 * Math.cos(i * 1.7 + 2)); // never correlated with B
  }
  const series = new Map<string, Daily>([["A", fromReturns(rA)], ["B", fromReturns(rB)], ["Z", fromReturns(rIndep)]]);
  const { decoupled } = scanPairs(["A", "B", "Z"], series, () => "Fin", () => 1, { minOverlap: 100 });
  const found = decoupled.find((d) => [d.a, d.b].sort().join("/") === "A/B");
  assert.ok(found, "A/B decoupling detected");
  assert.ok(found!.corrLong > 0.5, `corrLong ${found!.corrLong} was high`);
  assert.ok(found!.corrShort < 0.45, `corrShort ${found!.corrShort} collapsed`);
  assert.ok(found!.drop >= 0.35, `drop ${found!.drop}`);
  // the never-correlated Z pairs are NOT decoupled (they were never coupled to begin with)
  assert.ok(!decoupled.some((d) => d.a === "Z" || d.b === "Z"), "never-correlated Z not flagged");
});

test("scanPairs: STRETCHED — a cointegrated, mean-reverting, wide pair lands in the stretched list", () => {
  // B has CONSISTENT return variance in every window (an oscillating return series, not a flat drift)
  // so the pair stays correlated short-run and does NOT spuriously decouple; A = 2·logB + a stationary
  // spread. This is a genuine convergence pair → stretched, not decoupled.
  const N = 300;
  const rB = Array.from({ length: N }, (_, i) => 0.012 * Math.sin(i * 0.5));
  const logB: number[] = [0];
  for (const r of rB) logB.push(logB[logB.length - 1] + r);
  const spread = logB.map((_, i) => 0.02 * Math.sin(i * 0.13));
  const logA = logB.map((v, i) => 2 * v + spread[i]);
  const mk = (logs: number[]): Daily => logs.map((v, i) => [i * DAYMS, Math.exp(v)]);
  const series = new Map<string, Daily>([["A", mk(logA)], ["B", mk(logB)]]);
  const { stretched, decoupled } = scanPairs(["A", "B"], series, () => "Tech", () => 1, { minOverlap: 100, minAbsZ: 0, minHalfLife: 0.1, maxHalfLife: 1000 });
  assert.ok(stretched.some((p) => [p.a, p.b].sort().join("/") === "A/B"), "A/B stretched");
  assert.ok(!decoupled.some((p) => [p.a, p.b].sort().join("/") === "A/B"), "and NOT decoupled (stays correlated)");
});

test("scanPairs: a past deadline stops the scan immediately (budget honored)", () => {
  const series = new Map<string, Daily>([["A", fromReturns([0.01, -0.01, 0.02])], ["B", fromReturns([0.01, -0.01, 0.02])]]);
  const r = scanPairs(["A", "B"], series, () => "X", () => 1, { deadlineMs: Date.now() - 1 });
  assert.equal(r.truncated, true);
  assert.equal(r.pairsTested, 0);
});

test("scanPairs: DECOUPLED attributes the break to the leg that MOVED, even when it moved DOWN", () => {
  // Review finding: the old code used the spread sign (which leg is rich), so a down-catalyst named
  // the wrong leg. Here A takes a sharp DOWN move in the last 21d while B stays with the sector.
  const N = 280;
  const rB: number[] = [], rA: number[] = [];
  for (let i = 0; i < N; i++) {
    const b = 0.012 * Math.sin(i * 0.7);
    rB.push(b);
    rA.push(i < N - 21 ? b + 0.0008 * Math.sin(i * 13.1) : -0.02 + 0.004 * Math.cos(i * 2.3)); // A crashes
  }
  const series = new Map<string, Daily>([["A", fromReturns(rA)], ["B", fromReturns(rB)]]);
  const { decoupled } = scanPairs(["A", "B"], series, () => "Fin", () => 1, { minOverlap: 100 });
  const d = decoupled.find((x) => [x.a, x.b].sort().join("/") === "A/B")!;
  assert.ok(d, "A/B flagged");
  assert.equal(d.broke, "A", "the leg that actually moved (A) is named, not the spread-rich leg");
  assert.ok(d.brokeMovePct < 0, `A's move is negative (${d.brokeMovePct}%) — direction preserved`);
});

test("scanPairs: DECOUPLED fires even when the level hedge is invalid (β≤0, diverged prices)", () => {
  // Review finding: decoupling is a RETURNS-space signal; it must not be gated on a positive level
  // hedge. Returns correlated long-run, but A's price ~doubled while B's ~halved (β≤0), then break.
  const N = 280;
  const rB: number[] = [], rA: number[] = [];
  for (let i = 0; i < N; i++) {
    const shared = 0.01 * Math.sin(i * 0.6);
    rB.push(shared - 0.004); // secular DOWN drift
    rA.push((i < N - 21 ? shared + 0.0006 * Math.sin(i * 11) : 0.014 * Math.cos(i * 2.9)) + 0.004); // secular UP drift
  }
  const series = new Map<string, Daily>([["A", fromReturns(rA)], ["B", fromReturns(rB)]]);
  const { decoupled } = scanPairs(["A", "B"], series, () => "Ind", () => 1, { minOverlap: 100 });
  const d = decoupled.find((x) => [x.a, x.b].sort().join("/") === "A/B");
  assert.ok(d, "diverged-level pair still detected as decoupled");
  assert.ok(d!.beta === 0 || d!.beta > 0, "beta is 0 (no clean hedge) or positive — never crashes attribution");
});

test("scanPairs: a decoupled pair is NOT also in the stretched list (mutual exclusion)", () => {
  const N = 280;
  const rB: number[] = [], rA: number[] = [];
  for (let i = 0; i < N; i++) {
    const b = 0.012 * Math.sin(i * 0.7);
    rB.push(b);
    rA.push(i < N - 21 ? b + 0.0008 * Math.sin(i * 13.1) : 0.02 * Math.cos(i * 2.3));
  }
  const series = new Map<string, Daily>([["A", fromReturns(rA)], ["B", fromReturns(rB)]]);
  const { stretched, decoupled } = scanPairs(["A", "B"], series, () => "Fin", () => 1, { minOverlap: 100, minAbsZ: 0, minHalfLife: 0.1, maxHalfLife: 1000 });
  const key = (x: { a: string; b: string }) => [x.a, x.b].sort().join("/");
  const dk = new Set(decoupled.map(key));
  assert.ok(dk.has("A/B"), "A/B is decoupled");
  assert.ok(!stretched.some((p) => dk.has(key(p))), "no pair appears in BOTH lists");
});

test("scanPairs: a FROZEN/halted recent window (flat leg) is NOT a false decoupling", () => {
  // A halted name carried forward flat has zero recent variance → corr(flat, x)=0 artificially.
  const N = 280;
  const rB: number[] = [], rA: number[] = [];
  for (let i = 0; i < N; i++) {
    const b = 0.012 * Math.sin(i * 0.7);
    rB.push(b);
    rA.push(i < N - 21 ? b + 0.0008 * Math.sin(i * 13.1) : 0); // A goes FLAT (halted) for the last 21d
  }
  const series = new Map<string, Daily>([["A", fromReturns(rA)], ["B", fromReturns(rB)]]);
  const { decoupled } = scanPairs(["A", "B"], series, () => "Fin", () => 1, { minOverlap: 100 });
  assert.ok(!decoupled.some((x) => [x.a, x.b].sort().join("/") === "A/B"), "flat/frozen leg not flagged as a break");
});
