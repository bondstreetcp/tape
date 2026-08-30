import { test } from "node:test";
import assert from "node:assert/strict";
import { sellPremiumScore } from "../lib/volDislocation";
import type { VolDisRow } from "../lib/volDislocation";

// Pins the composite sell-premium score: it must reward richer variance premium, apply the
// earnings-trap haircut, and stay NaN-free when IV-rank / vs-sector aren't available (they often are null).
const mk = (o: Partial<VolDisRow>): VolDisRow => ({
  symbol: "TST", name: "Test", sector: "Tech", price: 100, marketCap: 1e10,
  atmIV: 0.4, rvol: 0.3, ivPremium: 1.3, termCrush: null, skew: null, ivRank: null,
  rvolRank: null, daysToEarnings: null, earningsDriven: false, sectorPremium: null,
  vsSector: null, pctile: 50, ...o,
});

test("score rises with the variance premium", () => {
  const lo = sellPremiumScore(mk({ ivPremium: 1.1 })).score;
  const mid = sellPremiumScore(mk({ ivPremium: 1.5 })).score;
  const hi = sellPremiumScore(mk({ ivPremium: 1.9 })).score;
  assert.ok(lo < mid && mid < hi, `expected monotonic, got ${lo} < ${mid} < ${hi}`);
});

test("earnings-driven rich vol is haircut vs the identical non-earnings name", () => {
  const clean = sellPremiumScore(mk({ ivPremium: 1.8, earningsDriven: false }));
  const trap = sellPremiumScore(mk({ ivPremium: 1.8, earningsDriven: true }));
  assert.ok(trap.score < clean.score, `trap ${trap.score} should be < clean ${clean.score}`);
  assert.equal(trap.earningsTrap, true);
  assert.ok(trap.drivers.some((d) => /earnings/i.test(d)), "a driver tag should name the earnings trap");
});

test("IV-rank and vs-sector lift the score when present, and null inputs never NaN", () => {
  const bare = sellPremiumScore(mk({ ivPremium: 1.5, ivRank: null, vsSector: null }));
  const rich = sellPremiumScore(mk({ ivPremium: 1.5, ivRank: 95, vsSector: 0.4 }));
  assert.ok(Number.isFinite(bare.score) && Number.isFinite(rich.score));
  assert.ok(rich.score > bare.score, `full-signal ${rich.score} should beat bare ${bare.score}`);
  assert.ok(bare.score >= 0 && rich.score <= 100);
});

test("skew picks the richer side to sell", () => {
  assert.equal(sellPremiumScore(mk({ skew: 0.12 })).side, "puts"); // downside bid → puts richer
  assert.equal(sellPremiumScore(mk({ skew: -0.08 })).side, "calls"); // upside bid → calls richer
  assert.equal(sellPremiumScore(mk({ skew: 0.0 })).side, "either");
});
