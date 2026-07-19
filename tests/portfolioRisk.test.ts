import { test } from "node:test";
import assert from "node:assert/strict";
import { alignDailyReturns, computePortfolioRisk, type AlignedReturns } from "../lib/portfolioRisk";
import type { Daily } from "../lib/pairs";

const approx = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const DAY = 86_400_000;
const series = (prices: number[], startDay = 1000): Daily => prices.map((p, i) => [(startDay + i) * DAY, p]);
// Build an AlignedReturns directly (bypasses alignment) to unit-test computePortfolioRisk in isolation.
const mk = (returns: Record<string, number[]>): AlignedReturns => {
  const n = Math.max(...Object.values(returns).map((r) => r.length));
  return { dates: Array.from({ length: n }, (_, i) => (1000 + i) * DAY), returns };
};

test("alignDailyReturns: shared days, simple returns, day-bucketing", () => {
  const s = alignDailyReturns({
    AAPL: series([100, 110, 99], 1000), // days 1000..1002
    MSFT: series([50, 55, 60, 66], 999), // days 999..1002 (extra earlier day dropped by intersection)
  });
  assert.deepEqual(s.dates, [1001 * DAY, 1002 * DAY]);
  approx(s.returns.AAPL[0], 0.1);
  approx(s.returns.AAPL[1], 99 / 110 - 1);
  approx(s.returns.MSFT[0], 60 / 55 - 1);
  approx(s.returns.MSFT[1], 66 / 60 - 1);
});

test("computePortfolioRisk: single name — vol annualizes, contribution = 1", () => {
  const r = Array.from({ length: 40 }, (_, i) => ((i * 7) % 11 - 5) / 100);
  const risk = computePortfolioRisk([{ symbol: "AAPL", value: 10000 }], mk({ AAPL: r }))!;
  assert.ok(risk);
  approx(risk.volAnnDollar, risk.volDailyDollar * Math.sqrt(252));
  approx(risk.coverage, 1);
  approx(risk.contributions[0].pctRisk, 1, 1e-9); // one name carries 100% of its own risk
  assert.ok(risk.var99Dollar + 1e-9 >= risk.var95Dollar); // deeper tail ≥ shallower
  assert.ok(risk.worstDayDollar <= 0);
});

test("computePortfolioRisk: contributions sum to 1; undiversified ≥ actual", () => {
  const rA = Array.from({ length: 60 }, (_, i) => ((i * 13) % 17 - 8) / 100);
  const rB = Array.from({ length: 60 }, (_, i) => ((i * 5) % 11 - 5) / 120);
  const risk = computePortfolioRisk(
    [{ symbol: "AAPL", value: 20000 }, { symbol: "MSFT", value: -5000 }],
    mk({ AAPL: rA, MSFT: rB }),
  )!;
  approx(risk.contributions.reduce((a, c) => a + c.pctRisk, 0), 1, 1e-9);
  assert.ok(risk.undiversifiedVolDailyDollar >= risk.volDailyDollar - 1e-6);
  assert.ok(risk.diversificationBenefit >= 0 && risk.diversificationBenefit <= 1);
});

test("computePortfolioRisk: perfect hedge → ~0 vol, full diversification", () => {
  const a = Array.from({ length: 30 }, (_, i) => (i % 2 ? 1 : -1) * 0.02);
  const risk = computePortfolioRisk(
    [{ symbol: "AAPL", value: 10000 }, { symbol: "MSFT", value: 10000 }],
    mk({ AAPL: a, MSFT: a.map((x) => -x) }), // MSFT is AAPL's mirror → book P&L ≈ 0 daily
  )!;
  approx(risk.volDailyDollar, 0, 1e-9);
  approx(risk.diversificationBenefit, 1, 1e-9);
});

test("computePortfolioRisk: coverage < 1 without series; null when too short", () => {
  const r = Array.from({ length: 30 }, (_, i) => ((i * 7) % 11 - 5) / 100);
  const risk = computePortfolioRisk(
    [{ symbol: "AAPL", value: 6000 }, { symbol: "NOPE", value: 4000 }], // NOPE unpriced
    mk({ AAPL: r }),
  )!;
  approx(risk.coverage, 0.6);
  assert.equal(computePortfolioRisk([{ symbol: "AAPL", value: 6000 }], mk({ AAPL: r.slice(0, 5) })), null);
});
