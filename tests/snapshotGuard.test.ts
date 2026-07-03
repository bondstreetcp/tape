import { test } from "node:test";
import assert from "node:assert/strict";
import { snapshotWriteAllowed } from "../lib/snapshotGuard";

// The write-guard's whole job is one decision boundary; pin it so a future "tweak the threshold"
// can't silently start shipping half-empty snapshots (or start blocking healthy rebuilds).

test("allows the first write when there is no prior snapshot", () => {
  assert.equal(snapshotWriteAllowed(null, 503).allowed, true);
});

test("allows a healthy full rebuild (no drop)", () => {
  assert.equal(snapshotWriteAllowed(503, 503).allowed, true);
});

test("allows normal churn (a handful of names in/out)", () => {
  assert.equal(snapshotWriteAllowed(503, 483).allowed, true);
});

test("allows exactly a 15% drop (boundary is inclusive)", () => {
  assert.equal(snapshotWriteAllowed(500, 425).allowed, true);
});

test("blocks a 16% drop (just past the boundary)", () => {
  assert.equal(snapshotWriteAllowed(500, 420).allowed, false);
});

test("blocks a 40% partial-fetch night", () => {
  const r = snapshotWriteAllowed(500, 300);
  assert.equal(r.allowed, false);
  assert.match(r.reason, /collapsed 40%/);
});

test("blocks a near-empty snapshot", () => {
  assert.equal(snapshotWriteAllowed(500, 5).allowed, false);
});

test("does NOT let a thin prior lock the pipeline (bootstrap floor)", () => {
  // prior below the bootstrap floor (20) is itself half-built — a rebuild must be allowed through.
  assert.equal(snapshotWriteAllowed(12, 3).allowed, true);
});

test("protects a small curated intl universe at its own scale", () => {
  assert.equal(snapshotWriteAllowed(40, 40).allowed, true); // healthy
  assert.equal(snapshotWriteAllowed(40, 10).allowed, false); // collapsed
});

test("honours a custom drop tolerance", () => {
  // With a 50% tolerance, a 40% drop is allowed; with the default 15% it is not.
  assert.equal(snapshotWriteAllowed(500, 300, { maxDropRatio: 0.5 }).allowed, true);
  assert.equal(snapshotWriteAllowed(500, 300).allowed, false);
});
