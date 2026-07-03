import { test } from "node:test";
import assert from "node:assert/strict";
import { beatGuide, guideVsConsensus, type GuidanceHistoryPoint, type GuidancePeriod } from "../lib/guidance";

// beatGuide is the sandbagger stat — "how often does this company beat its own guide". It aligns each
// quarter's actual EPS to the next-quarter guide given ONE filing earlier, but only for consecutive
// (~quarterly, 60–130d apart) filings. A mistake here mislabels conservative guiders as aggressive.

const hp = (date: string, reportedEps: number | null, lo: number | null, hi: number | null): GuidanceHistoryPoint =>
  ({ date, reportedEps, nextQEpsLow: lo, nextQEpsHigh: hi });

test("beatGuide: null when fewer than two aligned pairs", () => {
  assert.equal(beatGuide(undefined), null);
  assert.equal(beatGuide([hp("2026-06-01", 2.1, 2.0, 2.0)]), null); // one filing → no pair
});

test("beatGuide: aligns actual to the prior filing's next-quarter guide", () => {
  // newest first. Each filing reports its own quarter's actual + guides the NEXT quarter.
  const history = [
    hp("2026-06-01", 2.1, 2.05, 2.15), // Q reported here was guided in the Mar filing (mid 2.00) → 2.1 ≥ 2.00 BEAT
    hp("2026-03-01", 1.9, 1.95, 2.05), // Q reported here was guided in the Dec filing (mid 2.00) → 1.9 < 2.00 MISS
    hp("2025-12-01", 1.8, 1.95, 2.05),
  ];
  const r = beatGuide(history);
  assert.ok(r != null);
  assert.equal(r!.total, 2);
  assert.equal(r!.beats, 1);
  // avgVsGuide = mean( 2.1/2.0−1 , 1.9/2.0−1 ) = mean(+0.05, −0.05) = 0
  assert.ok(Math.abs(r!.avgVsGuide! - 0) < 1e-9);
});

test("beatGuide: skips non-consecutive filings (gap outside 60–130d)", () => {
  const annual = [
    hp("2026-06-01", 2.1, 1.9, 2.1),
    hp("2025-06-01", 1.9, 1.9, 2.1), // ~365d gap → not consecutive quarters → skipped
    hp("2024-06-01", 1.8, 1.9, 2.1),
  ];
  assert.equal(beatGuide(annual), null); // no valid pairs → below the 2-pair minimum
});

test("beatGuide: ignores a pair whose guide midpoint is missing", () => {
  const history = [
    hp("2026-06-01", 2.1, 2.0, 2.0),
    hp("2026-03-01", 1.9, null, null), // no guide → this pair can't be scored
    hp("2025-12-01", 1.8, 2.0, 2.0),
  ];
  // only one scorable pair remains (i=1 uses the Dec guide) → below the 2-pair minimum → null
  assert.equal(beatGuide(history), null);
});

// guideVsConsensus: the guide MIDPOINT vs the Street, as a fraction. Null when not comparable.
const period = (over: Partial<GuidancePeriod>): GuidancePeriod =>
  ({ period: "FY2026", revLowM: null, revHighM: null, epsLow: null, epsHigh: null, action: "reaffirm", ...over });

test("guideVsConsensus: midpoint vs the Street", () => {
  const g = period({ revLowM: 900, revHighM: 1100, epsLow: 1.8, epsHigh: 2.2 }); // mids: rev 1000, eps 2.0
  const r = guideVsConsensus(g, 950, 1.9);
  assert.ok(Math.abs(r.revPct! - (1000 / 950 - 1)) < 1e-9);
  assert.ok(Math.abs(r.epsPct! - (2.0 / 1.9 - 1)) < 1e-9);
});

test("guideVsConsensus: null when a consensus leg is missing or zero", () => {
  const g = period({ revLowM: 1000, revHighM: 1000, epsLow: 2.0, epsHigh: 2.0 });
  const r = guideVsConsensus(g, null, 0);
  assert.equal(r.revPct, null);
  assert.equal(r.epsPct, null);
});

test("guideVsConsensus: single-sided guide uses the given bound as the midpoint", () => {
  const g = period({ revLowM: null, revHighM: null, epsLow: 2.0, epsHigh: null }); // only a low → mid 2.0
  const r = guideVsConsensus(g, null, 1.6);
  assert.ok(Math.abs(r.epsPct! - (2.0 / 1.6 - 1)) < 1e-9);
  assert.equal(r.revPct, null);
});
