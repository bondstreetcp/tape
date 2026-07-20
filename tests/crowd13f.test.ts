import { test } from "node:test";
import assert from "node:assert/strict";
import { crowd13fOverlap } from "../lib/crowd13f";

const THEMES = [
  { heading: "Semis / AI", tickers: ["NVDA", "AMD", "TSM", "INTC"] },
  { heading: "Mega-cap software", tickers: ["MSFT", "GOOGL"] },
  { heading: "Energy", tickers: ["XOM", "CVX"] },
];

test("crowd13fOverlap: per-theme holdings + gross share, sorted, deduped union", () => {
  const o = crowd13fOverlap(
    [
      { symbol: "NVDA", value: 100000 },
      { symbol: "AMD", value: 20000 },
      { symbol: "MSFT", value: 30000 },
      { symbol: "AAPL", value: 50000 }, // in no theme
    ],
    THEMES,
    "2026-03-31",
  )!;
  assert.equal(o.asOf, "2026-03-31");
  assert.equal(o.totalNames, 3); // NVDA, AMD, MSFT
  // gross = 200k; overlap gross = 150k
  assert.ok(Math.abs(o.overlapGrossPct - 150000 / 200000) < 1e-9);
  // Semis theme leads (120k > 30k), and NVDA sorts before AMD within it (by exposure)
  assert.equal(o.themes[0].heading, "Semis / AI");
  assert.deepEqual(o.themes[0].holdings, ["NVDA", "AMD"]);
  assert.ok(Math.abs(o.themes[0].grossPct - 120000 / 200000) < 1e-9);
  assert.equal(o.themes[1].heading, "Mega-cap software");
  assert.equal(o.themes.length, 2); // Energy has no overlap → dropped
});

test("crowd13fOverlap: case-insensitive symbol match", () => {
  const o = crowd13fOverlap([{ symbol: "nvda", value: 1000 }], THEMES, "x")!;
  assert.equal(o.totalNames, 1);
  assert.deepEqual(o.themes[0].holdings, ["NVDA"]);
});

test("crowd13fOverlap: null when no overlap or empty inputs", () => {
  assert.equal(crowd13fOverlap([{ symbol: "AAPL", value: 1000 }], THEMES, "x"), null);
  assert.equal(crowd13fOverlap([], THEMES, "x"), null);
  assert.equal(crowd13fOverlap([{ symbol: "NVDA", value: 1 }], [], "x"), null);
});
