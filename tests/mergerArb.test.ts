import { test } from "node:test";
import assert from "node:assert/strict";
import { dealValuePerShare, arbMetrics, rankArb, type Deal, type ArbRow } from "../lib/mergerArb";

const approx = (a: number, b: number, tol = 1e-4) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b} (±${tol})`);
const NOW = Date.parse("2026-07-04T00:00:00Z");

const base: Deal = {
  targetTicker: "TGT", targetName: "Target Co", acquirer: "Acq Inc", acquirerTicker: "ACQ",
  structure: "cash", cashPerShare: null, exchangeRatio: null, cvr: false,
  expectedClose: null, announced: "2026-06-01", url: "http://x",
};

test("dealValuePerShare: cash / stock / mixed / missing-leg", () => {
  assert.equal(dealValuePerShare({ structure: "cash", cashPerShare: 17, exchangeRatio: null }, null), 17);
  assert.equal(dealValuePerShare({ structure: "stock", cashPerShare: null, exchangeRatio: 0.5 }, 100), 50);
  assert.equal(dealValuePerShare({ structure: "mixed", cashPerShare: 5, exchangeRatio: 0.5 }, 100), 55);
  assert.equal(dealValuePerShare({ structure: "stock", cashPerShare: null, exchangeRatio: 0.5 }, null), null); // no acquirer price
  assert.equal(dealValuePerShare({ structure: "cash", cashPerShare: null, exchangeRatio: null }, null), null); // no terms
});

test("arbMetrics: cash deal spread + annualized (TBPH-like $17 vs $16.93, close in 60d)", () => {
  const deal: Deal = { ...base, structure: "cash", cashPerShare: 17, expectedClose: "2026-09-02" };
  const r = arbMetrics(deal, 16.93, null, NOW);
  approx(r.dealValue!, 17);
  approx(r.grossSpreadPct!, (17 / 16.93 - 1) * 100); // ≈ 0.4134%
  assert.equal(r.daysToClose, 60);
  approx(r.annualizedPct!, ((17 / 16.93 - 1) * 100) * (365 / 60)); // ≈ 2.515%
});

test("arbMetrics: unpriced legs → null spread, no throw", () => {
  const stockNoAcq = arbMetrics({ ...base, structure: "stock", exchangeRatio: 0.4, expectedClose: "2026-10-01" }, 20, null, NOW);
  assert.equal(stockNoAcq.dealValue, null);
  assert.equal(stockNoAcq.grossSpreadPct, null);
  assert.equal(stockNoAcq.annualizedPct, null); // no spread → no annualization
  const noClose = arbMetrics({ ...base, structure: "cash", cashPerShare: 50 }, 48, null, NOW);
  assert.ok(noClose.grossSpreadPct! > 0);
  assert.equal(noClose.daysToClose, null); // no close date → gross spread only, no annualization
  assert.equal(noClose.annualizedPct, null);
  // A stale (past) close estimate must NOT annualize a spread over "1 day" into a nonsense 1000%+.
  const pastClose = arbMetrics({ ...base, structure: "cash", cashPerShare: 50, expectedClose: "2026-06-30" }, 48.5, null, NOW);
  assert.ok(pastClose.grossSpreadPct! > 0);
  assert.equal(pastClose.daysToClose, null);
  assert.equal(pastClose.annualizedPct, null);
});

test("rankArb: widest annualized first, unpriced last", () => {
  const mk = (t: string, ann: number | null, gross: number | null): ArbRow =>
    ({ ...base, targetTicker: t, targetPrice: null, acquirerPrice: null, dealValue: null, grossSpreadPct: gross, daysToClose: null, annualizedPct: ann });
  const ranked = rankArb([mk("A", 5, 1), mk("B", 25, 3), mk("C", null, null), mk("D", 12, 2)]);
  assert.deepEqual(ranked.map((r) => r.targetTicker), ["B", "D", "A", "C"]);
});
