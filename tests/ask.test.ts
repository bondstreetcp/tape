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
