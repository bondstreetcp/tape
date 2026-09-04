import { test } from "node:test";
import assert from "node:assert/strict";
import { advanceGate } from "../lib/incrementalGate";

// The incremental gate is what makes a nightly extractor cheap (skip names with no new release) — and what
// silently LOST quarters when it advanced past a release that failed to read or extract. These pin the rule:
// advance only on a processed newest release; otherwise stay put (or stay unset), so the next run retries.

test("a processed newest release advances the gate", () => {
  assert.equal(advanceGate("0001-26-000020", true, "0001-26-000015"), "0001-26-000020");
  assert.equal(advanceGate("0001-26-000020", true, undefined), "0001-26-000020");
});

test("THE LOST-QUARTER TRAP: a newest release that failed to read/extract must NOT advance the gate", () => {
  // EDGAR returned no text (or the LLM timed out) on the new 8-K — the prior accession stays, so the next
  // nightly run sees the release as new again and retries instead of skipping the quarter forever.
  assert.equal(advanceGate("0001-26-000020", false, "0001-26-000015"), "0001-26-000015");
});

test("a first-ever run that fails leaves the gate unset (falsy), so the name is retried next run", () => {
  assert.equal(advanceGate("0001-26-000020", false, undefined), "");
});
