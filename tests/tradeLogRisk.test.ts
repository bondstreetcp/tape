import { test } from "node:test";
import assert from "node:assert/strict";
import { computeRiskFlags, crossedCredit, marginPerShare, prePrintDriftPct, THIN_CREDIT_PCT, type TradeLeg } from "../lib/tradeLog";

// The 2026-08-05 "scale it up?" audit instrumentation. These pin the pure math: the Reg-T margin
// approximation against hand-computed examples, the crossed-fill rule, the ATKR drift back-out, and
// the flag thresholds (only thin-credit is a MEASURED handicap; the rest are logged context).

const L = (type: "C" | "P", side: "long" | "short", strike: number, premium: number, bid?: number, ask?: number): TradeLeg =>
  ({ type, side, strike, premium, bid: bid ?? null, ask: ask ?? null });

test("margin: defined-risk structures margin their max loss (condor = width − credit)", () => {
  // 95/100 put spread + 110/115 call spread, credits 1.2 + 1.1 → width 5, credit 2.3 → risk 2.7.
  const condor = [
    L("P", "long", 95, 0.8), L("P", "short", 100, 2.0),
    L("C", "short", 110, 1.9), L("C", "long", 115, 0.8),
  ];
  const m = marginPerShare(condor, 105);
  assert.ok(m != null && Math.abs(m - 2.7) < 1e-9, `condor margin ${m} should equal width−credit = 2.7`);
});

test("margin: long straddle needs only its debit", () => {
  const straddle = [L("C", "long", 100, 3.1), L("P", "long", 100, 2.9)];
  const m = marginPerShare(straddle, 100);
  assert.ok(m != null && Math.abs(m - 6.0) < 1e-9, `long straddle margin ${m} should equal the 6.0 debit`);
});

test("margin: naked short strangle uses the Reg-T greater-side rule", () => {
  // Spot 100, short 90P @2, short 110C @2.5.
  //   call side: 2.5 + max(0.2·100 − 10, 0.1·100) = 2.5 + 10 = 12.5
  //   put  side: 2.0 + max(0.2·100 − 10, 0.1·90)  = 2.0 + 10 = 12.0
  // margin = greater side (12.5) + other side's premium (2.0) = 14.5
  const strangle = [L("P", "short", 90, 2.0), L("C", "short", 110, 2.5)];
  const m = marginPerShare(strangle, 100);
  assert.ok(m != null && Math.abs(m - 14.5) < 1e-9, `strangle margin ${m} should be 14.5`);
});

test("margin: deep-OTM naked put falls back to the 10%-of-strike floor", () => {
  // Spot 100, short 50P @0.2: 0.2 + max(20 − 50, 5) = 5.2 — the floor binds, not the 20% formula.
  const m = marginPerShare([L("P", "short", 50, 0.2)], 100);
  assert.ok(m != null && Math.abs(m - 5.2) < 1e-9, `deep OTM put margin ${m} should be 5.2`);
});

test("crossed fill: shorts sell the bid, longs pay the ask; one-sided book → null", () => {
  // Mid credit would be 4.7; crossed = 2.05 + 2.40 = 4.45 — the spread is the first, guaranteed cost.
  const legs = [L("P", "short", 237.5, 2.17, 2.05, 2.29), L("C", "short", 262.5, 2.52, 2.4, 2.65)];
  assert.equal(crossedCredit(legs), 4.45);
  const long = [L("C", "long", 100, 3.0, 2.9, 3.1), L("P", "long", 100, 2.0, 1.9, 2.1)];
  assert.equal(crossedCredit(long), -5.2); // pays the ask on both
  assert.equal(crossedCredit([L("C", "short", 100, 1.0)]), null); // no quote captured → no fiction
});

test("drift: the ATKR numbers — reaction close 93.53, print move −0.02%, struck at 71", () => {
  const d = prePrintDriftPct(71, 93.53, -0.02);
  assert.ok(d != null && Math.abs(d - 31.76) < 0.05, `ATKR drift ${d} should be ≈ +31.8%`);
  // No drift: stock sat still, print moved it 5% — pre-print close equals the strike-setting spot.
  const flat = prePrintDriftPct(100, 105, 5);
  assert.ok(flat != null && Math.abs(flat) < 1e-6);
});

test("flags: thin-credit is the measured handicap; the rest annotate context", () => {
  const base = { verdict: "rich" as const, entryCredit: 2, spotAtRec: 100, maxLoss: -5, impliedMovePct: 8 };
  assert.deepEqual(computeRiskFlags(base), []); // 2% credit, defined risk, no gap info — clean
  assert.deepEqual(computeRiskFlags({ ...base, entryCredit: 1.0 }), ["thin-credit"]); // 1% < 1.5%
  assert.ok(computeRiskFlags({ ...base, maxLoss: null }).includes("undefined-risk"));
  assert.ok(computeRiskFlags({ ...base, gapDays: 6 }).includes("wide-gap"));
  assert.ok(computeRiskFlags({ ...base, histMaxPct: 12 }).includes("implied<hist-max")); // sold 8, name has done 12
  assert.ok(!computeRiskFlags({ ...base, histMaxPct: 6 }).includes("implied<hist-max"));
  assert.ok(computeRiskFlags({ ...base, catalystFlag: { kind: "spin-off" } }).includes("catalyst"));
  // Buys never flag thin-credit (they PAY premium) nor implied<hist-max (that's a seller's tell).
  assert.deepEqual(computeRiskFlags({ verdict: "cheap", entryCredit: -5, spotAtRec: 100, maxLoss: -5, impliedMovePct: 8, histMaxPct: 12 }), []);
  assert.equal(THIN_CREDIT_PCT, 0.015);
});
