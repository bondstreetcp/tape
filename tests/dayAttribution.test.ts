import { test } from "node:test";
import assert from "node:assert/strict";
import { dayAttribution } from "../lib/dayAttribution";

test("dayAttribution: value·ret1d, shorts flip, sorted by |pnl|, coverage", () => {
  const a = dayAttribution([
    { symbol: "NVDA", value: 30000, ret1d: 4 }, // +$1200
    { symbol: "AAPL", value: 20000, ret1d: -2 }, // −$400
    { symbol: "TSLA", value: -10000, ret1d: 5 }, // short up 5% → −$500
    { symbol: "NOPE", value: 5000 }, // no ret1d → excluded
  ], 100000)!;
  assert.equal(a.contributors[0].symbol, "NVDA"); // biggest |pnl|
  assert.equal(Math.round(a.contributors.find((c) => c.symbol === "TSLA")!.pnl), -500); // short rose → loss
  assert.equal(Math.round(a.totalPnl), 1200 - 400 - 500); // +300
  assert.ok(Math.abs(a.totalPct! - 300 / 100000) < 1e-9);
  assert.ok(Math.abs(a.coverage - 60000 / 65000) < 1e-9); // 3 of 4 have a 1d return
});

test("dayAttribution: null when no 1-day returns", () => {
  assert.equal(dayAttribution([{ symbol: "X", value: 1000 }], 1000), null);
});
