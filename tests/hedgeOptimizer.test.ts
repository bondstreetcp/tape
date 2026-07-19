import { test } from "node:test";
import assert from "node:assert/strict";
import { optimizeHedge, solveLinear } from "../lib/hedgeOptimizer";
import type { AlignedReturns } from "../lib/portfolioRisk";

const approx = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const DAY = 86_400_000;
const aligned = (returns: Record<string, number[]>): AlignedReturns => {
  const n = Math.max(...Object.values(returns).map((r) => r.length));
  return { dates: Array.from({ length: n }, (_, i) => (1000 + i) * DAY), returns };
};

test("solveLinear: solves a small system; null on singular", () => {
  const x = solveLinear([[2, 1], [1, 3]], [5, 10])!; // x=1, y=3
  approx(x[0], 1);
  approx(x[1], 3);
  assert.equal(solveLinear([[1, 2], [2, 4]], [1, 2]), null); // singular
});

test("optimizeHedge: a book that IS an ETF gets ~fully hedged by shorting it", () => {
  const spy = Array.from({ length: 80 }, (_, i) => ((i * 7) % 13 - 6) / 100);
  const qqq = Array.from({ length: 80 }, (_, i) => ((i * 5) % 11 - 5) / 100); // ~independent alt
  const book = aligned({ XYZ: spy }); // the holding moves exactly like SPY
  const opt = optimizeHedge([{ symbol: "XYZ", value: 10000 }], book, { SPY: spy, QQQ: qqq }, { ridge: 0.001 })!;
  assert.equal(opt.legs[0].etf, "SPY"); // SPY dominates the solution
  assert.ok(opt.legs[0].notional < 0, "shorts SPY"); // short to offset a long book
  assert.ok(opt.volReduction > 0.9, `vol cut ${opt.volReduction}`); // book ≈ SPY → nearly fully hedgeable
  assert.ok(opt.volAfterDollar < opt.volBeforeDollar);
  const sumLegs = opt.legs.reduce((a, l) => a + Math.abs(l.notional), 0);
  assert.ok(opt.turnoverDollar + 1e-6 >= sumLegs); // turnover = full overlay incl. tiny dropped legs
});

test("optimizeHedge: an uncorrelated book can't be hedged much", () => {
  const noise = Array.from({ length: 80 }, (_, i) => (((i * 131) % 97) - 48) / 1000); // book noise
  const spy = Array.from({ length: 80 }, (_, i) => ((i * 7) % 13 - 6) / 100);
  const opt = optimizeHedge([{ symbol: "ZZZ", value: 10000 }], aligned({ ZZZ: noise }), { SPY: spy }, { ridge: 0.05 })!;
  assert.ok(opt.volReduction < 0.5, `little to hedge, got ${opt.volReduction}`);
});

test("optimizeHedge: maxGross scales the overlay down", () => {
  const spy = Array.from({ length: 80 }, (_, i) => ((i * 7) % 13 - 6) / 100);
  const capped = optimizeHedge([{ symbol: "XYZ", value: 50000 }], aligned({ XYZ: spy }), { SPY: spy }, { ridge: 0.001, maxGross: 1000 })!;
  assert.ok(capped.turnoverDollar <= 1000 + 1e-6);
});

test("optimizeHedge: null when no ETF series or book too short", () => {
  const spy = Array.from({ length: 80 }, (_, i) => ((i * 7) % 13 - 6) / 100);
  assert.equal(optimizeHedge([{ symbol: "XYZ", value: 1 }], aligned({ XYZ: spy }), {}), null); // no ETFs
  const short = Array.from({ length: 10 }, (_, i) => i / 100);
  assert.equal(optimizeHedge([{ symbol: "XYZ", value: 1 }], aligned({ XYZ: short }), { SPY: short }), null); // <30 days
});
