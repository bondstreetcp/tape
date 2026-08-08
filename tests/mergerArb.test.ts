import { test } from "node:test";
import assert from "node:assert/strict";
import { isSpac, spreadMath, priceInText, DEFAULT_CLOSE_DAYS } from "../lib/mergerArb";

// /merger-arb pure logic — the spread math, the SPAC filter, and the code-verification of the price.

test("spread + annualized: a normal cash deal", () => {
  // $50 deal, stock at $48, ~73 days to close → spread +4.17%, annualized ≈ +20.8%.
  const m = spreadMath(50, 48, 73);
  assert.equal(m.spreadPct, 4.17);
  assert.ok(m.annualizedPct != null && Math.abs(m.annualizedPct - 20.8) < 0.2);
});

test("a negative spread (stock above the deal) is kept, not hidden", () => {
  const m = spreadMath(50, 52, 90); // market expects a bump
  assert.ok(m.spreadPct != null && m.spreadPct < 0);
  assert.ok(m.annualizedPct != null && m.annualizedPct < 0);
});

test("no cash price or no quote → null, never fabricated", () => {
  assert.deepEqual(spreadMath(null, 48, 90), { spreadPct: null, annualizedPct: null });
  assert.deepEqual(spreadMath(50, null, 90), { spreadPct: null, annualizedPct: null });
  assert.deepEqual(spreadMath(50, 0, 90), { spreadPct: null, annualizedPct: null });
});

test("annualizer clamps a nonsense zero horizon to 1 day (no divide-by-zero)", () => {
  const m = spreadMath(50, 49, 0);
  assert.ok(m.annualizedPct != null && Number.isFinite(m.annualizedPct));
  assert.equal(DEFAULT_CLOSE_DAYS, 120);
});

test("SPAC / blank-check names are excluded", () => {
  assert.equal(isSpac("Bleichroeder Acquisition Corp. II"), true);
  assert.equal(isSpac("Some Blank Check Company"), true);
  assert.equal(isSpac("Arcosa, Inc."), false);
  assert.equal(isSpac("AstroNova, Inc."), false);
});

test("price verification demands a dollar amount, not a bare number", () => {
  const text = "each share will be converted into the right to receive $50.00 per share in cash. See page 50.";
  assert.equal(priceInText(text, 50), true); // "$50.00 per share"
  assert.equal(priceInText(text, 50.0), true);
  assert.equal(priceInText("this is section 47 of the agreement", 47), false); // bare number = section ref
});

test("dedupeTargets: latest DEFM14A per ticker wins (amendments/supplements collapse), newest first", async () => {
  const { dedupeTargets } = await import("../lib/mergerArb");
  const out = dedupeTargets([
    { ticker: "kvue", name: "Kenvue Inc", filedAt: "2026-06-01" },
    { ticker: "KVUE", name: "Kenvue Inc", filedAt: "2026-07-15" }, // amendment, later — wins (case-folded)
    { ticker: "ABCD", name: "Abcd Corp", filedAt: "2026-07-01" },
  ]);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0], { ticker: "KVUE", name: "Kenvue Inc", filedAt: "2026-07-15" });
  assert.equal(out[1].ticker, "ABCD");
});
