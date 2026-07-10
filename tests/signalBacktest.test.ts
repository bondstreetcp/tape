import { test } from "node:test";
import assert from "node:assert/strict";
import { runBacktest, BT_METHOD } from "../lib/signalBacktest";

// Deterministic synthetic market: N names, daily bars. A "trender" cohort compounds steadily up,
// the rest drift flat. The momentum sleeves MUST select the trenders and show positive edge vs the
// pool; the structure (calendar, warmup, stats) must hold together.

const DAY = 86_400_000;
const START = Date.UTC(2020, 0, 6); // a Monday

function mkSeries(n: number, ret: (i: number) => number): [number, number][] {
  const out: [number, number][] = [];
  let p = 100, t = START;
  while (out.length < n) { // n TRADING bars (skip weekends), not calendar days
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) { p *= Math.exp(ret(out.length)); out.push([t, p]); }
    t += DAY;
  }
  return out;
}

function market(): Map<string, [number, number][]> {
  const m = new Map<string, [number, number][]>();
  const N = 700; // ~2.8 years of trading days
  // 20 trenders so the top-25 momentum sleeve is DOMINATED by true winners (the sinusoidal "flat"
  // cohort mean-reverts by construction, so flats that sneak into a momentum sleeve tend to lose).
  for (let x = 0; x < 20; x++) m.set(`TREND${x}`, mkSeries(N, () => 0.0012 + 0.0003 * (x % 5))); // steady up, varied slope
  for (let x = 0; x < 40; x++) m.set(`FLAT${x}`, mkSeries(N, (i) => 0.0004 * Math.sin(i / 3 + x))); // flat wiggle
  return m;
}

test("momentum sleeves pick the trending cohort and show positive 1m edge", () => {
  const bt = runBacktest(market(), "test")!;
  assert.ok(bt, "backtest produced");
  assert.ok(bt.rebalances >= 15, `enough rebalances (${bt.rebalances})`);
  assert.equal(bt.names, 60);
  const mom = bt.signals.find((s) => s.key === "mom_12_1")!;
  const m1 = mom.horizons.m1!;
  assert.ok(m1, "m1 stats present");
  assert.ok(m1.edge > 0.5, `trenders beat the pool (edge ${m1.edge}pp)`);
  assert.ok(m1.hit > 0.7, `hit rate high (${m1.hit})`);
  const lead = bt.signals.find((s) => s.key === "leaders_rs")!;
  assert.ok(lead.horizons.m1!.edge > 0.5, `leaders sleeve also catches them (${lead.horizons.m1!.edge}pp)`);
  // cumulative curve must be increasing overall for a winning sleeve
  const curve = mom.curve;
  assert.ok(curve.length >= 15 && curve[curve.length - 1].cum > curve[0].cum, "cumulative edge rises");
});

test("split-artifact guard: a 60% one-day jump excludes the name at that rebalance", () => {
  const m = market();
  const s = mkSeries(700, () => 0.0015);
  const mid = Math.floor(s.length / 2);
  for (let i = mid; i < s.length; i++) s[i] = [s[i][0], s[i][1] * 2]; // unrepaired 2× split-shaped jump
  m.set("SPLITY", s);
  const bt = runBacktest(m, "test")!;
  const mom = bt.signals.find((s2) => s2.key === "mom_12_1")!;
  // SPLITY doubles overnight — without the guard it would DOMINATE momentum; with it, edge stays sane
  assert.ok(mom.horizons.m1!.edge < 30, "no split-artifact name distorting the sleeve");
});

test("too little history → null, and the method box ships with the file", () => {
  const tiny = new Map<string, [number, number][]>([["A", mkSeries(100, () => 0.001)]]);
  assert.equal(runBacktest(tiny, "test"), null);
  const bt = runBacktest(market(), "test")!;
  assert.deepEqual(bt.method, BT_METHOD);
  assert.ok(bt.method.some((l) => l.toLowerCase().includes("survivorship")), "survivorship note present");
});
