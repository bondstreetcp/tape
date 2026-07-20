import { test } from "node:test";
import assert from "node:assert/strict";
import { volOverlay, type VolInfo } from "../lib/volOverlay";

test("volOverlay: exposure-weighted RV/percentile, elevated + earnings watch", () => {
  const vol: Record<string, VolInfo> = {
    AAPL: { rv: 0.30, rvPct: 88, daysToEarnings: 3, expMovePct: 5 },
    MSFT: { rv: 0.20, rvPct: 40 },
    NVDA: { rv: 0.50, rvPct: 92, daysToEarnings: 20 }, // earnings too far out
  };
  const o = volOverlay([
    { symbol: "AAPL", value: 60000 },
    { symbol: "MSFT", value: 40000 },
    { symbol: "NVDA", value: 100000 },
    { symbol: "NOPE", value: 50000 }, // no cone data
  ], vol)!;
  // exposure-weighted RV over the 3 covered names (60k·.30 + 40k·.20 + 100k·.50)/200k
  assert.ok(Math.abs(o.avgRv! - (60000 * 0.30 + 40000 * 0.20 + 100000 * 0.50) / 200000) < 1e-9);
  assert.deepEqual(o.elevated.map((e) => e.symbol), ["NVDA", "AAPL"]); // pct ≥ 80, sorted desc
  assert.deepEqual(o.earnings.map((e) => e.symbol), ["AAPL"]); // only AAPL within 14 days
  assert.ok(Math.abs(o.earningsGrossPct - 60000 / 250000) < 1e-9);
  assert.ok(Math.abs(o.coverage - 200000 / 250000) < 1e-9);
});

test("volOverlay: null when no cone data", () => {
  assert.equal(volOverlay([{ symbol: "X", value: 1000 }], {}), null);
});
