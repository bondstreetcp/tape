import { test } from "node:test";
import assert from "node:assert/strict";
import { localEligible, FLASH_MODEL, PRO_MODEL } from "../lib/llm";

// The local-inference routing contract: which chat calls are eligible to be served by the local
// overnight box (when LLM_LOCAL_* is configured). localEligible() is the whole decision; wantLocal
// just ANDs it with "is a local server configured". Getting this wrong either burns cloud spend
// (nightly job stays cloud) or, worse, drags a LIVE page load onto the batch box.

test("bare-default nightly extraction routes local (ipo, corp-events, biotech, catalyst-vol…)", () => {
  assert.equal(localEligible({}), true);
});

test("PRO judgment tier stays cloud (campaigns, transcript-analysis, supply-chain…)", () => {
  assert.equal(localEligible({ model: PRO_MODEL }), false);
});

test("Flash-pinned LIVE routes stay cloud by default (compensation, exec-bios)", () => {
  // They pin an explicit model and do NOT opt in, so the heuristic keeps them off the batch box.
  assert.equal(localEligible({ model: FLASH_MODEL }), false);
});

test("Flash-pinned NIGHTLY extractors opt IN explicitly (guidance, overnight-filings)", () => {
  assert.equal(localEligible({ model: FLASH_MODEL, local: true }), true);
});

test("a bare-default LIVE route can force cloud (stocktwits-summary)", () => {
  assert.equal(localEligible({ local: false }), false);
});

test("explicit local flag always wins over the model heuristic", () => {
  assert.equal(localEligible({ model: PRO_MODEL, local: true }), true); // forced local
  assert.equal(localEligible({ local: false }), false); // forced cloud even bare-default
  assert.equal(localEligible({ model: undefined, local: undefined }), true); // heuristic fallthrough
});
