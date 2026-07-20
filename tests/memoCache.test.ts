import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { memo, memoClear } from "../lib/memoCache";

// The NAS origin has no CDN — memo IS the cache layer for live API routes, so its semantics
// (dedup, cacheIf, serve-stale-on-error) are load-bearing. Each behavior gets a worked case.

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

beforeEach(() => memoClear());

test("hit: second call within TTL returns the cached value without recomputing", async () => {
  let calls = 0;
  const fn = async () => ++calls;
  assert.equal(await memo("k", 60_000, fn), 1);
  assert.equal(await memo("k", 60_000, fn), 1, "must serve the cached value");
  assert.equal(calls, 1, "fn must not run again inside the TTL");
});

test("expiry: a call after the TTL recomputes", async () => {
  let calls = 0;
  const fn = async () => ++calls;
  await memo("k", 10, fn);
  await sleep(25);
  assert.equal(await memo("k", 10, fn), 2, "expired entry must recompute");
  assert.equal(calls, 2);
});

test("in-flight dedup: N concurrent misses share ONE computation (the Yahoo-stampede guard)", async () => {
  let calls = 0;
  const fn = async () => { calls++; await sleep(30); return "v"; };
  const results = await Promise.all([memo("k", 60_000, fn), memo("k", 60_000, fn), memo("k", 60_000, fn)]);
  assert.deepEqual(results, ["v", "v", "v"]);
  assert.equal(calls, 1, "concurrent requests must not fan out");
});

test("different keys do not share entries or in-flight computations", async () => {
  let calls = 0;
  const fn = async () => ++calls;
  const [a, b] = await Promise.all([memo("a", 60_000, fn), memo("b", 60_000, fn)]);
  assert.notEqual(a, b);
  assert.equal(calls, 2);
});

test("cacheIf false: the value is returned but NOT cached (a null AI preview must not brick the key)", async () => {
  let calls = 0;
  const fn = async () => { calls++; return calls === 1 ? null : "real"; };
  const cacheIf = (v: string | null) => v != null;
  assert.equal(await memo("k", 60_000, fn, { cacheIf }), null, "first result passes through");
  assert.equal(await memo("k", 60_000, fn, { cacheIf }), "real", "the miss must retry, not serve the null");
  assert.equal(await memo("k", 60_000, fn, { cacheIf }), "real", "the good value IS cached");
  assert.equal(calls, 2);
});

test("serve-stale-on-error: a failed recompute serves the expired entry (STALE, never EMPTY)", async () => {
  let calls = 0;
  const fn = async () => { calls++; if (calls > 1) throw new Error("yahoo down"); return "good"; };
  assert.equal(await memo("k", 10, fn), "good");
  await sleep(25); // let it expire
  assert.equal(await memo("k", 10, fn), "good", "expired-but-present beats a thrown error");
  assert.equal(calls, 2, "the recompute WAS attempted");
});

test("error with no prior entry rethrows (nothing to degrade to)", async () => {
  await assert.rejects(memo("k", 60_000, async () => { throw new Error("boom"); }), /boom/);
  // and the failure must not poison the key — a later success computes and caches normally
  assert.equal(await memo("k", 60_000, async () => "ok"), "ok");
});

test("eviction: the store stays bounded and evicts the OLDEST entry first", async () => {
  // Fill past MAX_ENTRIES (800) with distinct keys; "first" is cached earliest so it is the eviction victim.
  await memo("first", 60_000, async () => "seed");
  for (let i = 0; i < 800; i++) await memo(`fill:${i}`, 60_000, async () => i);
  let recomputed = false;
  assert.equal(await memo("first", 60_000, async () => { recomputed = true; return "again"; }), "again");
  assert.equal(recomputed, true, "the oldest key must have been evicted");
  // a recent key is still cached
  let recomputedRecent = false;
  await memo("fill:799", 60_000, async () => { recomputedRecent = true; return -1; });
  assert.equal(recomputedRecent, false, "recent keys survive eviction");
});
