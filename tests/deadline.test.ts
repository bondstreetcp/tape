import { test } from "node:test";
import assert from "node:assert/strict";
import { withDeadline, isDeadline, deadline, DeadlineError, VENDOR_TIMEOUT_MS, VENDOR_BUDGET_MS } from "../lib/deadline";
import { recoverable } from "../lib/yahooClient";

// The bound that `export const maxDuration` was silently NOT providing on a self-hosted origin.
// These pin the two behaviours the rest of the codebase now depends on: a wall-clock race that
// actually fires, and a timeout that yahooClient classifies as non-retryable.

test("withDeadline resolves normally when the work finishes in time", async () => {
  assert.equal(await withDeadline(Promise.resolve("ok"), 1000, "fast"), "ok");
});

test("withDeadline rejects with a labelled DeadlineError once the clock runs out", async () => {
  const never = new Promise((r) => setTimeout(r, 5000));
  await assert.rejects(withDeadline(never, 20, "yahoo chart AAPL"), (e: any) => {
    assert.ok(e instanceof DeadlineError);
    assert.match(e.message, /yahoo chart AAPL exceeded 20ms/);
    return true;
  });
});

test("withDeadline passes the original rejection through untouched (it bounds, it doesn't mask)", async () => {
  await assert.rejects(withDeadline(Promise.reject(new Error("429 rate limited")), 1000, "x"), /429 rate limited/);
});

test("withDeadline clears its timer on success — no dangling handle keeps a CLI process alive", async () => {
  // If the timer leaked, a short-lived script (the nightly refreshes) would hang after its work.
  const t0 = Date.now();
  await withDeadline(Promise.resolve(1), 60_000, "x");
  assert.ok(Date.now() - t0 < 1000, "resolved immediately rather than waiting out the timeout");
});

test("isDeadline recognises both our error and AbortSignal.timeout's TimeoutError", () => {
  assert.equal(isDeadline(new DeadlineError("x", 1)), true);
  assert.equal(isDeadline({ name: "TimeoutError" }), true);
  assert.equal(isDeadline(new Error("429 rate limited")), false);
  assert.equal(isDeadline(null), false);
});

test("a TIMEOUT is NOT retried on a fresh Yahoo client — the ceiling must stay a ceiling", () => {
  // A fresh cookie/crumb cannot cure an endpoint that isn't answering; retrying would silently
  // double the ~20s bound the caller was promised.
  assert.equal(recoverable(new DeadlineError("yahoo chart AAPL", 20_000)), false);
  assert.equal(recoverable({ name: "TimeoutError" }), false);
  // …while a genuine stale-crumb failure still heals as before
  assert.equal(recoverable({ code: 401, message: "invalid crumb" }), true);
  assert.equal(recoverable({ code: 429, message: "Too Many Requests" }), false);
});

test("deadline() returns a live AbortSignal that fires", async () => {
  const sig = deadline(20);
  assert.equal(sig.aborted, false);
  await new Promise((r) => setTimeout(r, 60));
  assert.equal(sig.aborted, true);
});

test("the shared ceilings are sane relative to Cloudflare's ~100s patience", () => {
  assert.ok(VENDOR_TIMEOUT_MS < 100_000, "a single attempt must finish before the tunnel gives up");
  assert.ok(VENDOR_BUDGET_MS >= VENDOR_TIMEOUT_MS, "a retry loop's budget can't be tighter than one attempt");
  assert.ok(VENDOR_BUDGET_MS < 100_000, "the whole retry loop must also fit inside it");
});
