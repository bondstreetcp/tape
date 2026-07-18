import { test } from "node:test";
import assert from "node:assert/strict";
import { callWithHeal, recoverable } from "../lib/yahooClient";

// A fake "client" is just a tag; fn decides success/failure per client, so we exercise the pure
// retry-then-heal control flow without touching the network.
type Client = { id: string };

test("healthy path: primary succeeds → no retry, no heal, no log", async () => {
  const logs: string[] = [];
  let healed: Client | null = null;
  const r = await callWithHeal<Client, string>(
    { id: "shared" },
    () => { throw new Error("makeFresh must NOT be called"); },
    async (c) => `ok:${c.id}`,
    (c) => { healed = c; },
    (stage) => logs.push(stage),
  );
  assert.equal(r, "ok:shared");
  assert.equal(healed, null, "onHeal not called when the primary worked");
  assert.deepEqual(logs, [], "no logs on the happy path");
});

test("stale-crumb heal: primary throws, fresh succeeds → returns fresh result, adopts it, logs retry only", async () => {
  const logs: string[] = [];
  let healed: Client | null = null;
  let madeFresh = 0;
  const r = await callWithHeal<Client, string>(
    { id: "stale" },
    () => { madeFresh++; return { id: "fresh" }; },
    async (c) => { if (c.id === "stale") throw new Error("Invalid Crumb"); return `ok:${c.id}`; },
    (c) => { healed = c; },
    (stage) => logs.push(stage),
  );
  assert.equal(r, "ok:fresh", "the fresh client's result is returned");
  assert.equal(madeFresh, 1, "exactly one fresh client made");
  assert.deepEqual(healed, { id: "fresh" }, "the working fresh client is adopted");
  assert.deepEqual(logs, ["retry"], "only the retry stage logs; no failure");
});

test("recoverable error both times: logs retry + fail, does NOT heal, rethrows the second error", async () => {
  const logs: string[] = [];
  let healed = false;
  await assert.rejects(
    () =>
      callWithHeal<Client, string>(
        { id: "stale" },
        () => ({ id: "fresh" }),
        async () => { throw new Error("fetch failed"); },
        () => { healed = true; },
        (stage) => logs.push(stage),
        () => true,
      ),
    /fetch failed/,
    "the caller still sees the real error (its own .catch decides null/fallback)",
  );
  assert.equal(healed, false, "a client that also fails is NOT adopted");
  assert.deepEqual(logs, ["retry", "fail"], "both stages logged");
});

test("non-recoverable (shouldRetry=false): NO fresh instance, logs 'skip', rethrows the FIRST error", async () => {
  const logs: string[] = [];
  let madeFresh = 0;
  await assert.rejects(
    () =>
      callWithHeal<Client, string>(
        { id: "blocked" },
        () => { madeFresh++; return { id: "fresh" }; },
        async () => { throw new Error("429 Too Many Requests"); },
        () => {},
        (stage) => logs.push(stage),
        () => false, // a hard block: don't hammer it a second time
      ),
    /429/,
  );
  assert.equal(madeFresh, 0, "a blocked endpoint is NOT hit again nor a fresh crumb minted");
  assert.deepEqual(logs, ["skip"], "logged as skipped, not retried");
});

test("recoverable(): stale crumb + transient network retry; rate-limit/forbidden/no-data do not", () => {
  // recoverable = worth a fresh-crumb retry
  assert.equal(recoverable(new Error("Invalid Crumb")), true);
  assert.equal(recoverable(new Error("fetch failed")), true);
  assert.equal(recoverable(Object.assign(new Error("Unauthorized"), { code: 401 })), true);
  assert.equal(recoverable(Object.assign(new Error("Server Error"), { code: 503 })), true);
  // NOT recoverable — a fresh crumb can't cure these
  assert.equal(recoverable(Object.assign(new Error("Too Many Requests"), { code: 429 })), false);
  assert.equal(recoverable(Object.assign(new Error("Forbidden"), { code: 403 })), false);
  assert.equal(recoverable(Object.assign(new Error("Not Found"), { code: 404 })), false);
  assert.equal(recoverable(new Error("No data found for symbol ZZZZ")), false);
});
