import { test } from "node:test";
import assert from "node:assert/strict";
import { fiscalQuarterEndMs, isCompleteQuarter, momentumFrom, qLabel, MIN_YOY_BASE_USD, type QuarterPoint } from "../lib/govContracts";

// /gov-contracts momentum — pinned to the two bugs the first live run exposed: an incomplete current
// fiscal quarter dragging every TTM negative (LMT −49.7%), and a near-zero prior base minting a
// million-percent "riser" (Cencora +2,774,987%).

test("federal fiscal quarter ends: Q1 Dec-31 prior year, Q4 Sep-30", () => {
  assert.equal(new Date(fiscalQuarterEndMs(2026, 1)).toISOString().slice(0, 10), "2025-12-31");
  assert.equal(new Date(fiscalQuarterEndMs(2026, 2)).toISOString().slice(0, 10), "2026-03-31");
  assert.equal(new Date(fiscalQuarterEndMs(2026, 3)).toISOString().slice(0, 10), "2026-06-30");
  assert.equal(new Date(fiscalQuarterEndMs(2026, 4)).toISOString().slice(0, 10), "2026-09-30");
});

test("the in-progress quarter is not 'complete' until the reporting lag clears", () => {
  const aug6 = Date.parse("2026-08-06");
  assert.equal(isCompleteQuarter(2026, 4, aug6), false); // Q4 ends Sep 30 — nowhere near done
  assert.equal(isCompleteQuarter(2026, 3, aug6), true); // Q3 ended Jun 30, >45d ago
  // A just-closed quarter inside the lag window is still incomplete.
  assert.equal(isCompleteQuarter(2026, 3, Date.parse("2026-07-10")), false); // only 10d past Jun 30
});

const q = (fy: number, quarter: number, amount: number): QuarterPoint => ({ fiscal_year: fy, quarter, amount });

test("momentum excludes the partial current quarter (the LMT −49.7% bug)", () => {
  // 8 complete quarters flat at $10B, plus a 1/3-filled current quarter. TTM must read flat, not down.
  const pts = [
    q(2024, 3, 10e9), q(2024, 4, 10e9), q(2025, 1, 10e9), q(2025, 2, 10e9),
    q(2025, 3, 10e9), q(2025, 4, 10e9), q(2026, 1, 10e9), q(2026, 2, 10e9),
    q(2026, 3, 3e9), // Q3 just ended (partial data), Q4 in progress
  ];
  const m = momentumFrom(pts, Date.parse("2026-07-05")); // Q3 within lag → excluded
  assert.equal(m.ttmObligated, 40e9, "TTM = last 4 COMPLETE quarters");
  assert.equal(m.yoyPct, 0, "flat, not negative — the partial quarter is out");
  assert.equal(m.latestQuarter, "FY26 Q2", "latest COMPLETE quarter");
  assert.ok(m.quarters.at(-1)?.partial, "the partial quarter still shows in the sparkline, flagged");
});

test("a near-zero prior base yields null yoy, never a giant number (the Cencora bug)", () => {
  const pts = [
    q(2024, 3, 100), q(2024, 4, 100), q(2025, 1, 100), q(2025, 2, 100), // prior base ≈ $400
    q(2025, 3, 2e9), q(2025, 4, 2e9), q(2026, 1, 2e9), q(2026, 2, 2e9),
  ];
  const m = momentumFrom(pts, Date.parse("2026-08-06"));
  assert.equal(m.yoyPct, null, `prior base under ${MIN_YOY_BASE_USD} → null, not +millions%`);
  assert.equal(m.ttmObligated, 8e9);
});

test("a genuine riser above the base floor computes a real yoy", () => {
  const pts = [
    q(2024, 3, 1e9), q(2024, 4, 1e9), q(2025, 1, 1e9), q(2025, 2, 1e9), // base $4B
    q(2025, 3, 1.5e9), q(2025, 4, 1.5e9), q(2026, 1, 1.5e9), q(2026, 2, 1.5e9), // ttm $6B
  ];
  const m = momentumFrom(pts, Date.parse("2026-08-06"));
  assert.equal(m.yoyPct, 50);
  assert.equal(qLabel({ fiscal_year: 2026, quarter: 2 }), "FY26 Q2");
});
