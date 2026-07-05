import { test } from "node:test";
import assert from "node:assert/strict";
import {
  invNormal, midrankPct, buildFactorModel, computeFactorTilts, computeCrowding,
  type FactorInput, type FactorKey,
} from "../lib/factors";

const approx = (a: number, b: number, tol = 1e-3) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

test("invNormal: known quantiles + monotonic", () => {
  approx(invNormal(0.5), 0, 1e-6);
  approx(invNormal(0.975), 1.959964, 1e-3);
  approx(invNormal(0.025), -1.959964, 1e-3);
  approx(invNormal(0.8413447), 1, 2e-3); // +1σ
  assert.ok(invNormal(0.2) < invNormal(0.4) && invNormal(0.4) < invNormal(0.9));
  assert.ok(Number.isFinite(invNormal(0)) && Number.isFinite(invNormal(1))); // clamped, not ±Inf
});

test("midrankPct: midrank within a sorted array", () => {
  const s = [10, 20, 30, 40];
  approx(midrankPct(s, 30), (2 + 0.5) / 4); // 0.625
  approx(midrankPct(s, 10), (0 + 0.5) / 4); // 0.125
  approx(midrankPct(s, 5), 0); // below all
  approx(midrankPct(s, 50), 1); // above all
  approx(midrankPct([10, 10, 10, 10], 10), 0.5); // all equal → midrank 0.5
  approx(midrankPct([], 5), 0.5); // empty → neutral
});

// A universe where only ONE field varies, so a factor's ordering is deterministic.
const vary = (field: keyof FactorInput, vals: number[]): FactorInput[] =>
  vals.map((v, i) => ({ symbol: `N${i}`, [field]: v }) as FactorInput);

test("buildFactorModel: cheaper P/E → higher Value σ, monotonic + centered", () => {
  const m = buildFactorModel(vary("trailingPE", [10, 15, 20, 25, 30, 35, 40, 45, 50]));
  const hi = m.score({ symbol: "X", trailingPE: 10 }).value!; // cheapest
  const mid = m.score({ symbol: "X", trailingPE: 30 }).value!; // median
  const lo = m.score({ symbol: "X", trailingPE: 50 }).value!; // priciest
  assert.ok(hi > 0 && lo < 0, `hi=${hi} lo=${lo}`);
  approx(mid, 0, 0.3); // median ≈ neutral
  assert.ok(hi > mid && mid > lo); // monotone in cheapness
});

test("buildFactorModel: momentum ↑ with trailing return; size ↑ with mktcap; lowvol ↑ as beta ↓", () => {
  const mom = buildFactorModel(vary("r1y", [-20, -10, 0, 10, 20, 30, 40, 50, 60]));
  assert.ok(mom.score({ symbol: "X", r1y: 60 }).momentum! > mom.score({ symbol: "X", r1y: -20 }).momentum!);

  const size = buildFactorModel(vary("marketCap", [1e9, 5e9, 1e10, 5e10, 1e11, 5e11, 1e12, 2e12, 4e12]));
  assert.ok(size.score({ symbol: "X", marketCap: 4e12 }).size! > 0); // mega-cap → +σ
  assert.ok(size.score({ symbol: "X", marketCap: 1e9 }).size! < 0); // small → −σ

  const lv = buildFactorModel(vary("beta", [0.2, 0.4, 0.6, 0.8, 1.0, 1.2, 1.5, 1.8, 2.2]));
  assert.ok(lv.score({ symbol: "X", beta: 0.2 }).lowvol! > 0); // defensive → +σ
  assert.ok(lv.score({ symbol: "X", beta: 2.2 }).lowvol! < 0); // high-beta → −σ
});

test("buildFactorModel: missing data → null score for that factor", () => {
  const m = buildFactorModel(vary("trailingPE", [10, 20, 30, 40, 50]));
  const s = m.score({ symbol: "X", trailingPE: 25 }); // only a value input given
  assert.equal(s.momentum, null);
  assert.equal(s.quality, null);
  assert.ok(typeof s.value === "number");
});

test("computeFactorTilts: gross-signed-weighted σ, short-aware, coverage", () => {
  const F = (over: Partial<Record<FactorKey, number | null>>): Record<FactorKey, number | null> => ({
    value: null, quality: null, momentum: null, growth: null, yield: null, size: null, lowvol: null, ...over,
  });
  const tilts = computeFactorTilts([
    { value: 10000, factors: F({ momentum: 1.5 }) }, // long a high-mom name
    { value: -5000, factors: F({ momentum: -1.0 }) }, // short a low-mom name (adds to +mom tilt)
  ]);
  const mom = tilts.find((t) => t.key === "momentum")!;
  // (10000/15000)*1.5 + (-5000/15000)*(-1.0) = 1.0 + 0.3333
  approx(mom.tilt, 1.0 + 1 / 3);
  approx(mom.coverage, 1);
  const val = tilts.find((t) => t.key === "value")!;
  assert.equal(val.tilt, 0);
  assert.equal(val.coverage, 0);
  // sorted by |tilt| desc → momentum first
  assert.equal(tilts[0].key, "momentum");
});

test("computeCrowding: exposure-weighted avg correlation + top pairs", () => {
  const holdings = [
    { symbol: "A", value: 10000 },
    { symbol: "B", value: 10000 },
    { symbol: "C", value: 5000 },
  ]; // gross 25k → wA=wB=0.4, wC=0.2
  const c = computeCrowding(holdings, [
    { a: "A", b: "B", r: 0.9 },
    { a: "A", b: "C", r: 0.5 },
    { a: "B", b: "C", r: 0.1 },
  ]);
  // weights: AB=.16, AC=.08, BC=.08 → (.16*.9 + .08*.5 + .08*.1)/.32 = 0.6
  approx(c.avgCorr!, 0.6);
  assert.equal(c.topPairs[0].r, 0.9); // most correlated first
  assert.equal(c.nPairs, 3);
});
