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

test("eviction: a flood of expired short-TTL keys must not evict a LIVE long-TTL entry", async () => {
  // The mixed-TTL hazard the poller rollout introduces: ~250 short-TTL intraday keys churning
  // alongside 10-minute chart keys. Oldest-first eviction alone throws away the expensive long-lived
  // entries purely for being older, so expired keys must be reclaimed first.
  const longKey = "chart:AAPL";
  let longBuilds = 0;
  await memo(longKey, 600_000, async () => { longBuilds++; return "chart"; });
  for (let i = 0; i < 850; i++) await memo(`poll:${i}`, 1, async () => i); // expire instantly, force overflow
  await memo(longKey, 600_000, async () => { longBuilds++; return "chart"; });
  assert.equal(longBuilds, 1, "the live long-TTL entry must outlive a flood of expired short-TTL keys");
});

test("serve-stale-on-error survives ordinary eviction pressure (the reservoir isn't swept wholesale)", async () => {
  // My first eviction fix deleted EVERY expired entry on overflow — precisely the set serve-stale
  // draws from, turning a vendor outage from STALE into EMPTY. Expired entries are now only the
  // SECOND eviction tier, so a reservoir entry survives while anything staler exists to reclaim.
  let calls = 0;
  const fn = async () => { calls++; if (calls > 1) throw new Error("yahoo down"); return "good"; };
  await memo("precious", 5, fn);
  await new Promise((r) => setTimeout(r, 20));
  for (let i = 0; i < 300; i++) await memo(`live:${i}`, 600_000, async () => i); // live keys, no overflow
  assert.equal(await memo("precious", 5, fn), "good", "the expired entry must still serve stale on error");
  assert.equal(calls, 2, "and the refetch was genuinely attempted first");
});
