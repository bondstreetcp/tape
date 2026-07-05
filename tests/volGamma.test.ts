import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySetup, springScore, nearFlipPct, fuseVolGamma, type FusedRow } from "../lib/volGamma";
import type { GammaBoardRow } from "../lib/gammaBoard";
import type { VolConeFeedRow } from "../lib/volCone";

test("nearFlipPct: within threshold, null-safe", () => {
  assert.equal(nearFlipPct(2), true);
  assert.equal(nearFlipPct(-2.9), true);
  assert.equal(nearFlipPct(5), false);
  assert.equal(nearFlipPct(null), false);
  assert.equal(nearFlipPct(4, 5), true);
});

test("classifySetup: coiled / pinned / blown / none", () => {
  // coiled: low RV pct + short gamma
  assert.equal(classifySetup(15, "short", 40), "coiled");
  // coiled: low RV pct + near flip (even if long gamma)
  assert.equal(classifySetup(20, "long", 2), "coiled");
  // pinned: low-ish RV + long gamma + away from flip
  assert.equal(classifySetup(35, "long", 8), "pinned");
  // blown: high RV + short gamma
  assert.equal(classifySetup(90, "short", 20), "blown");
  // none: middling
  assert.equal(classifySetup(55, "long", 20), "none");
  // none: no cone data
  assert.equal(classifySetup(null, "short", 1), "none");
  // a low-ish-RV long-gamma name NEAR the flip is NOT "pinned" (the flip makes it unstable), but 30 isn't
  // cheap enough (≤25) to be "coiled" either → "none" (the flip is still shown in the board's Δflip column)
  assert.equal(classifySetup(30, "long", 2), "none");
  // right at the coiled threshold with an accelerant
  assert.equal(classifySetup(25, "long", 2), "coiled");
});

test("springScore: coiled-ness + short-gamma + flip bonuses; null on no cone", () => {
  // pct20=10 (coiled), short gamma (+25), near ±3 flip (+25) → (100-10)+25+25 = 140
  assert.equal(springScore(10, "short", 1), 140);
  // pct20=10, long gamma, mid flip ±5 (+12) → 90 + 0 + 12 = 102
  assert.equal(springScore(10, "long", 5), 102);
  // pct20=80 (blown), long gamma, far → 20
  assert.equal(springScore(80, "long", 30), 20);
  assert.equal(springScore(null, "short", 1), null);
  // monotonic: a more-coiled name scores higher, all else equal
  assert.ok(springScore(5, "short", 1)! > springScore(45, "short", 1)!);
});

const g = (o: Partial<GammaBoardRow>): GammaBoardRow => ({
  symbol: "X", name: "X", sector: "—", spot: 100, totalGex: 0, grossGex: 0, flip: null,
  distToFlipPct: null, regime: "long", pcRatio: null, callWall: null, putWall: null, expiries: 1, ...o,
});
const c = (o: Partial<VolConeFeedRow>): VolConeFeedRow => ({
  symbol: "X", name: "X", sector: "—", cur20: null, pct20: null, min20: null, med20: null, max20: null,
  cur63: null, pct63: null, cur252: null, termSlope: null, hist: 0, ...o,
});

test("fuseVolGamma: join by symbol, carry cone fields, classify + score", () => {
  const gamma = [
    g({ symbol: "AAA", regime: "short", distToFlipPct: 1 }),
    g({ symbol: "SPY", regime: "short", distToFlipPct: 0.5 }), // no cone row (ETF)
  ];
  const cone = [c({ symbol: "AAA", pct20: 12, cur20: 0.18, med20: 0.3 })];
  const fused = fuseVolGamma(gamma, cone);
  assert.equal(fused.length, 2);
  const aaa = fused.find((r) => r.symbol === "AAA")!;
  assert.equal(aaa.pct20, 12);
  assert.equal(aaa.cur20, 0.18);
  assert.equal(aaa.setup, "coiled"); // low RV + short gamma
  assert.equal(aaa.springScore, 100 - 12 + 25 + 25); // 138
  const spy = fused.find((r) => r.symbol === "SPY")!;
  assert.equal(spy.pct20, null); // no cone row → null cone fields
  assert.equal(spy.setup, "none");
  assert.equal(spy.springScore, null);
});

test("fuseVolGamma: symbol match is case-insensitive", () => {
  const fused = fuseVolGamma([g({ symbol: "msft", regime: "short", distToFlipPct: 2 })], [c({ symbol: "MSFT", pct20: 20 })]);
  assert.equal(fused[0].pct20, 20);
  assert.equal(fused[0].setup, "coiled");
});
