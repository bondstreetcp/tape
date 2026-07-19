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

test("optimizeHedge: market-neutral flattens the book's beta", () => {
  const m = Array.from({ length: 80 }, (_, i) => ((i * 7) % 13 - 6) / 100);
  const noise = Array.from({ length: 80 }, (_, i) => (((i * 29) % 17) - 8) / 200);
  const etf = { SPY: m, QQQ: Array.from({ length: 80 }, (_, i) => ((i * 5) % 11 - 5) / 100) };
  const a: AlignedReturns = { dates: m.map((_, i) => (1000 + i) * DAY), returns: { XYZ: m, ABC: noise }, market: m };
  const opt = optimizeHedge([{ symbol: "XYZ", value: 10000 }, { symbol: "ABC", value: 8000 }], a, etf, { ridge: 0.02, marketNeutral: true })!;
  assert.equal(opt.marketNeutral, true);
  // Rebuild the hedged P&L from the legs and confirm its market beta is ~0 (vs ~10000 before).
  const hOf = new Map(opt.legs.map((l) => [l.etf, l.notional]));
  const mean = (x: number[]) => x.reduce((s, v) => s + v, 0) / x.length;
  const cov = (x: number[], y: number[]) => { const mx = mean(x), my = mean(y); let s = 0; for (let t = 0; t < x.length; t++) s += (x[t] - mx) * (y[t] - my); return s / (x.length - 1); };
  const hedged = m.map((_, t) => 10000 * m[t] + 8000 * noise[t] + [...hOf].reduce((s, [e, h]) => s + h * (etf as Record<string, number[]>)[e][t], 0));
  const betaHedged = cov(hedged, m) / cov(m, m);
  assert.ok(Math.abs(betaHedged) < 500, `hedged beta ${betaHedged} ≈ 0 (was ~10000)`);
});

test("optimizeHedge: maxLegs caps the basket size", () => {
  const mk4 = (o: number) => Array.from({ length: 80 }, (_, i) => (((i * o) % 13) - 6) / 100);
  const etf = { SPY: mk4(7), QQQ: mk4(5), IWM: mk4(11), XLK: mk4(3) };
  const a: AlignedReturns = { dates: mk4(7).map((_, i) => (1000 + i) * DAY), returns: { BOOK: mk4(2) } };
  const opt = optimizeHedge([{ symbol: "BOOK", value: 100000 }], a, etf, { ridge: 0.02, maxLegs: 2 })!;
  assert.ok(opt.legs.length <= 2, `got ${opt.legs.length} legs`);
});

test("optimizeHedge: null when no ETF series or book too short", () => {
  const spy = Array.from({ length: 80 }, (_, i) => ((i * 7) % 13 - 6) / 100);
  assert.equal(optimizeHedge([{ symbol: "XYZ", value: 1 }], aligned({ XYZ: spy }), {}), null); // no ETFs
  const short = Array.from({ length: 10 }, (_, i) => i / 100);
  assert.equal(optimizeHedge([{ symbol: "XYZ", value: 1 }], aligned({ XYZ: short }), { SPY: short }), null); // <30 days
});
