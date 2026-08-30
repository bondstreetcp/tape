import { test } from "node:test";
import assert from "node:assert/strict";
import { lognormalPopEv } from "../lib/optionPayoffMath";

// Pins the POP+EV integrator: probability weights normalize, EV integrates payoff·density, and the
// whole point — a high hit-rate can still carry a negative expectancy — is representable.

test("constant-positive payoff → POP≈1, EV≈the constant", () => {
  const { pop, ev } = lognormalPopEv(() => 100, 50, 0.3, 30);
  assert.ok((pop as number) > 0.999, `pop ${pop}`);
  assert.ok(Math.abs((ev as number) - 100) < 1, `ev ${ev}`);
});

test("constant-negative payoff → POP=0, EV≈the constant", () => {
  const { pop, ev } = lognormalPopEv(() => -100, 50, 0.3, 30);
  assert.equal(pop, 0);
  assert.ok(Math.abs((ev as number) + 100) < 1, `ev ${ev}`);
});

test("EV scales linearly with the payoff", () => {
  const a = lognormalPopEv((S) => S - 50, 50, 0.3, 30);
  const b = lognormalPopEv((S) => 2 * (S - 50), 50, 0.3, 30);
  assert.ok(Math.abs((b.ev as number) - 2 * (a.ev as number)) < 1e-6);
});

test("bad inputs → null (no NaN leaks into the UI)", () => {
  assert.deepEqual(lognormalPopEv(() => 1, 0, 0.3, 30), { pop: null, ev: null });
  assert.deepEqual(lognormalPopEv(() => 1, 50, 0, 30), { pop: null, ev: null });
  assert.deepEqual(lognormalPopEv(() => 1, 50, 0.3, 0), { pop: null, ev: null });
});

test("high hit-rate can still carry negative expected value (the trap EV exposes)", () => {
  // Win a little with high probability, lose a lot in the rare tail → POP high, EV negative.
  const payoff = (S: number) => (S >= 45 ? 50 : -2000);
  const { pop, ev } = lognormalPopEv(payoff, 50, 0.3, 30);
  assert.ok((pop as number) >= 0.6, `expected high POP, got ${pop}`);
  assert.ok((ev as number) < 0, `expected negative EV, got ${ev}`);
});
