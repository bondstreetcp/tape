import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

// THE 2026-08-04 RED BOX: gemini-3.1-pro-preview (search grounding + unbounded thinking) blew the
// single 50s deadline on a routine "key risks" question, and the DOMException's own text — "The
// operation was aborted due to timeout" — travelled through the route's catch into the UI. askGemini
// now runs a ladder: primary with dynamic thinking, then a flash rescue with thinking off, then (and
// only then) a HUMAN error. These tests pin the ladder's routing: what gets rescued, what gets
// rethrown untouched, and what the user reads when everything is down. Fetch is mocked; the fake
// payloads carry no usageMetadata so recordUsage never fires (it flushes real telemetry on exit).

process.env.GEMINI_API_KEY = process.env.GEMINI_API_KEY || "test-key";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

/** What undici rejects with when AbortSignal.timeout fires (lib/deadline.isDeadline matches name). */
const timeoutErr = () => Object.assign(new Error("The operation was aborted due to timeout"), { name: "TimeoutError" });

const okResponse = (text: string) => ({
  ok: true,
  json: async () => ({
    candidates: [{
      content: { parts: [{ text }] },
      groundingMetadata: { groundingChunks: [{ web: { uri: "https://example.com", title: "Example" } }] },
    }],
  }),
}) as unknown as Response;

const httpError = (status: number, body: string) =>
  ({ ok: false, status, text: async () => body }) as unknown as Response;

/** Mock fetch from a call-by-call script; records the URLs hit. */
function scriptFetch(script: Array<() => Promise<Response> | Response>): string[] {
  const urls: string[] = [];
  let i = 0;
  globalThis.fetch = (async (url: any) => {
    urls.push(String(url));
    const step = script[Math.min(i++, script.length - 1)];
    return step();
  }) as typeof fetch;
  return urls;
}

const CTX = { name: "TestCo", text: "Revenue $1B" };

test("primary timeout → flash rescues with an answer (and its sources)", async () => {
  const { askGemini } = await import("../lib/ask");
  const urls = scriptFetch([
    () => Promise.reject(timeoutErr()),
    () => okResponse("flash answer"),
  ]);
  const r = await askGemini("q?", CTX);
  assert.equal(r?.answer, "flash answer");
  assert.equal(r?.sources.length, 1);
  assert.equal(urls.length, 2, "exactly one rescue attempt");
  assert.match(urls[1], /gemini-2\.5-flash/, "the rescue must run on the flash model");
});

test("both attempts time out → a HUMAN message, not the DOMException text", async () => {
  const { askGemini } = await import("../lib/ask");
  scriptFetch([() => Promise.reject(timeoutErr())]);
  await assert.rejects(
    () => askGemini("q?", CTX),
    (e: any) => {
      assert.match(String(e.message), /took too long/i, "must be the friendly message");
      assert.doesNotMatch(String(e.message), /operation was aborted/i, "raw DOMException text must not leak");
      return true;
    },
  );
});

test("a 400 (our config) is rethrown untouched — no rescue that would bury the actionable message", async () => {
  const { askGemini } = await import("../lib/ask");
  const urls = scriptFetch([() => httpError(400, "API key not valid")]);
  await assert.rejects(() => askGemini("q?", CTX), /Gemini 400: API key not valid/);
  assert.equal(urls.length, 1, "flash would fail identically — must not retry");
});

test("a 429 (Google overloaded) IS rescued", async () => {
  const { askGemini } = await import("../lib/ask");
  const urls = scriptFetch([
    () => httpError(429, "quota"),
    () => okResponse("rescued"),
  ]);
  const r = await askGemini("q?", CTX);
  assert.equal(r?.answer, "rescued");
  assert.equal(urls.length, 2);
});

// ── Concurrency hardening: in-flight coalescing (per-request locking) ──
// The "you both hit it, needed a second click" report: identical concurrent asks used to race two
// 40s search-grounded calls. They must now share ONE upstream call and all resolve to its answer.
test("identical concurrent asks coalesce onto ONE upstream call", async () => {
  const { askGemini } = await import("../lib/ask");
  let calls = 0;
  globalThis.fetch = (async () => { calls++; await new Promise((r) => setTimeout(r, 30)); return okResponse("shared"); }) as typeof fetch;
  const [a, b, c] = await Promise.all([
    askGemini("same?", CTX),
    askGemini("same?", CTX),
    askGemini("same?", CTX),
  ]);
  assert.equal(calls, 1, "three identical concurrent asks → exactly one upstream call");
  assert.equal(a?.answer, "shared");
  assert.equal(b?.answer, "shared");
  assert.equal(c?.answer, "shared");
});

test("distinct concurrent asks do NOT coalesce (different questions each run)", async () => {
  const { askGemini } = await import("../lib/ask");
  let calls = 0;
  globalThis.fetch = (async () => { calls++; await new Promise((r) => setTimeout(r, 20)); return okResponse("x"); }) as typeof fetch;
  await Promise.all([askGemini("q1?", CTX), askGemini("q2?", CTX)]);
  assert.equal(calls, 2, "two different questions must each run");
});

test("a settled ask does not stick in the in-flight map (a later identical ask re-runs)", async () => {
  const { askGemini } = await import("../lib/ask");
  let calls = 0;
  globalThis.fetch = (async () => { calls++; return okResponse("fresh"); }) as typeof fetch;
  await askGemini("later?", CTX);
  await askGemini("later?", CTX); // sequential, not concurrent → must NOT be coalesced onto the first
  assert.equal(calls, 2, "coalescing dedups only CONCURRENT duplicates, never caches a settled answer");
});
