import { test } from "node:test";
import assert from "node:assert/strict";
import { concentration } from "../lib/concentration";
import type { AlignedReturns } from "../lib/portfolioRisk";

const N = 120;
const dates = Array.from({ length: N }, (_, t) => t + 1);
// Two independent driving signals + noise, so we can build correlated / uncorrelated books deterministically.
const sigA = Array.from({ length: N }, (_, t) => 0.01 * Math.sin(t / 4));
const sigB = Array.from({ length: N }, (_, t) => 0.01 * Math.cos(t / 7));

const aligned = (returns: Record<string, number[]>): AlignedReturns => ({ dates, returns });

test("concentration: two uncorrelated equal-weight names ≈ 2 independent bets", () => {
  const c = concentration(
    [{ symbol: "A", value: 50000 }, { symbol: "B", value: 50000 }],
    aligned({ A: sigA.slice(), B: sigB.slice() }),
  )!;
  assert.equal(c.names, 2);
  assert.ok(Math.abs(c.independentBets - 2) < 0.1); // orthogonal signals → 2 real bets
  assert.ok(Math.abs(c.effectiveNamesBySize - 2) < 1e-9); // equal weight → 2 by size
  assert.ok(Math.abs(c.topPcShare - 0.5) < 0.1); // each signal ~half the variance
});

test("concentration: two perfectly correlated names → 1 independent bet", () => {
  const c = concentration(
    [{ symbol: "A", value: 50000 }, { symbol: "A2", value: 50000 }],
    aligned({ A: sigA.slice(), A2: sigA.slice() }), // identical series
  )!;
  assert.ok(Math.abs(c.independentBets - 1) < 0.05); // fully redundant → 1 bet
  assert.ok(c.topPcShare > 0.98); // one dominant PC
  assert.ok(Math.abs(c.effectiveNamesBySize - 2) < 1e-9); // still 2 by size — correlation is the whole story
});

test("concentration: a dominant position collapses the bet count", () => {
  const c = concentration(
    [{ symbol: "A", value: 970000 }, { symbol: "B", value: 15000 }, { symbol: "C", value: 15000 }],
    aligned({ A: sigA.slice(), B: sigB.slice(), C: sigB.map((x, t) => x + sigA[t] * 0.1) }),
  )!;
  assert.equal(c.names, 3);
  assert.ok(c.independentBets < 1.2); // 97% in one name → ~1 real bet despite 3 positions
  assert.ok(c.effectiveNamesBySize < 1.1); // sizing alone already says ~1
});

test("concentration: null on too few names or no history", () => {
  assert.equal(concentration([{ symbol: "A", value: 1 }], aligned({ A: sigA.slice() })), null);
  assert.equal(concentration([{ symbol: "A", value: 1 }, { symbol: "B", value: 1 }], aligned({})), null);
});
