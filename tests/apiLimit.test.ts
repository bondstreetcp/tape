import { test } from "node:test";
import assert from "node:assert/strict";
import { BucketRegistry, clientKey, takeToken } from "../lib/apiLimit";

// The LLM routes are open to the internet during the beta; these buckets are what stands between a crawler
// and the OpenRouter bill. Pin the math: burst = capacity, sustained = refill, honest Retry-After.

test("takeToken: a fresh bucket allows `capacity` calls at once, then refills continuously", () => {
  const spec = { capacity: 3, refillPerSec: 0.5 }; // one token every 2 s
  let b = undefined as ReturnType<typeof takeToken>["bucket"] | undefined;
  const t0 = 1_000_000;
  for (let i = 0; i < 3; i++) { const r = takeToken(b, spec, t0); assert.equal(r.ok, true); b = r.bucket; }
  const denied = takeToken(b, spec, t0);
  assert.equal(denied.ok, false);
  assert.equal(denied.retryAfterSec, 2); // a whole token is 2 s away
  const later = takeToken(denied.bucket, spec, t0 + 2_000);
  assert.equal(later.ok, true); // refilled exactly one
  const capped = takeToken(later.bucket, spec, t0 + 60_000);
  assert.ok(capped.bucket.tokens <= spec.capacity - 1); // refill never exceeds capacity
});

test("BucketRegistry: keys are independent, and fully-refilled idle buckets are pruned", () => {
  const reg = new BucketRegistry({ capacity: 2, refillPerSec: 1 }, 10);
  const t0 = 5_000_000;
  assert.equal(reg.take("a", t0).ok, true);
  assert.equal(reg.take("a", t0).ok, true);
  assert.equal(reg.take("a", t0).ok, false); // a is out
  assert.equal(reg.take("b", t0).ok, true); // b is untouched
  reg.prune(t0 + 10_000); // both refilled by now
  assert.equal(reg.size, 0);
});

test("clientKey: Cloudflare's header wins, then the first forwarded hop, then a local marker", () => {
  const h = (m: Record<string, string>) => ({ get: (k: string) => m[k.toLowerCase()] ?? null });
  assert.equal(clientKey(h({ "cf-connecting-ip": "203.0.113.9", "x-forwarded-for": "10.0.0.1" })), "203.0.113.9");
  assert.equal(clientKey(h({ "x-forwarded-for": "198.51.100.4, 10.0.0.1" })), "198.51.100.4");
  assert.equal(clientKey(h({})), "local");
});
