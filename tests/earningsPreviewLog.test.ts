import { test } from "node:test";
import assert from "node:assert/strict";
import { gradeEps, actualDirection, gradeReaction, summarizePreviews, EPS_HIT_ABS, type PreviewRec } from "../lib/earningsPreviewLog";

// The grading bands ARE the definition of "accurate" — pin them so the scorecard's meaning can't
// silently drift ("code verifies, models propose").

test("gradeEps: band is max(±2c, ±5% of actual) — penny-scale and large-EPS names both graded fairly", () => {
  // Penny-scale: actual $0.10 → band is the ABSOLUTE 2c (5% would be an absurd half-cent).
  assert.equal(gradeEps(0.12, 0.1)!.hit, true); // off by exactly 2c → hit
  assert.equal(gradeEps(0.13, 0.1)!.hit, false); // 3c → miss
  // Large-EPS: actual $10 → band is the RELATIVE 50c (2c would be absurdly tight).
  assert.equal(gradeEps(10.4, 10)!.hit, true); // 4% off → hit
  assert.equal(gradeEps(10.6, 10)!.hit, false); // 6% off → miss
  // Error % reported against |actual|.
  assert.ok(Math.abs(gradeEps(10.5, 10)!.errPct! - 5) < 1e-9);
  // Ungradable without both numbers.
  assert.equal(gradeEps(null, 1), null);
  assert.equal(gradeEps(1, null), null);
  assert.equal(EPS_HIT_ABS, 0.02);
});

test("gradeEps: negative-EPS quarters grade on |actual|", () => {
  assert.equal(gradeEps(-1.02, -1.0)!.hit, true); // 2% off a loss quarter → hit
  assert.equal(gradeEps(-0.9, -1.0)!.hit, false); // 10% off → miss
});

test("actualDirection: surprise maps to beat/miss with an inline dead zone", () => {
  assert.equal(actualDirection(0.03), "beat"); // +3% surprise
  assert.equal(actualDirection(-0.02), "miss");
  assert.equal(actualDirection(0.004), "inline"); // inside ±0.5%
  assert.equal(actualDirection(-0.005), "inline"); // boundary counts as inline
  assert.equal(actualDirection(null), null);
});

test("gradeReaction: sign match with a flat-print dead zone (a coin flip must not score)", () => {
  assert.equal(gradeReaction("up", 2.1), true);
  assert.equal(gradeReaction("up", -1.5), false);
  assert.equal(gradeReaction("down", -0.6), true);
  assert.equal(gradeReaction("down", 0.3), null); // |move| < 0.5% → flat, ungraded
  assert.equal(gradeReaction("up", null), null);
});

test("summarizePreviews: rates count only gradable recs; confidence split; empty input safe", () => {
  const base = {
    symbol: "X", name: "", loggedAt: "", earningsDate: "", consEps: 1, consRevB: null,
    predEps: 1, predRevB: null, vsConsensus: "beat" as const, reactionDir: "up" as const, calls: [],
  };
  const recs: PreviewRec[] = [
    { ...base, id: "A", confidence: "high", status: "settled", epsHit: true, epsErrPct: 2, dirHit: true, reactionHit: true },
    { ...base, id: "B", confidence: "high", status: "settled", epsHit: false, epsErrPct: 8, dirHit: false, reactionHit: null }, // flat print — reaction ungraded
    { ...base, id: "C", confidence: "low", status: "settled", epsHit: null, epsErrPct: null, dirHit: true, reactionHit: false }, // no actual EPS found
    { ...base, id: "D", confidence: "medium", status: "awaiting_print" },
  ];
  const s = summarizePreviews(recs);
  assert.equal(s.settledN, 3);
  assert.equal(s.preprintN, 1);
  assert.equal(s.epsGraded, 2); // C had no actual — excluded, not counted as a miss
  assert.equal(s.epsHits, 1);
  assert.ok(Math.abs((s.avgAbsEpsErrPct as number) - 5) < 1e-9); // (2+8)/2
  assert.equal(s.dirGraded, 3);
  assert.equal(s.dirHits, 2);
  assert.equal(s.reactionGraded, 2); // B's flat print excluded
  assert.equal(s.reactionHits, 1);
  assert.equal(s.byConfidence.high.dirGraded, 2);
  assert.equal(s.byConfidence.high.dirHits, 1);
  const empty = summarizePreviews([]);
  assert.equal(empty.settledN, 0);
  assert.equal(empty.avgAbsEpsErrPct, null);
});
