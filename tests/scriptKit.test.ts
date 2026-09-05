import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  mapPool, mapPoolSafe, sleep, swallow, quietly, suppressedCounts, resetSuppressed, parseSuppressed, SUPPRESSED_MARK,
  readJson, htmlToText, pct, money, BROWSER_UA, RESEARCH_UA,
} from "../lib/scriptKit";

/** Silence console.warn for a block and hand back what was logged. */
async function capturingWarn<T>(fn: () => Promise<T>): Promise<{ result: T; warned: string[] }> {
  const warned: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => { warned.push(a.map(String).join(" ")); };
  try { return { result: await fn(), warned }; } finally { console.warn = orig; }
}

test("mapPool keeps input order and never exceeds the concurrency cap", async () => {
  let inFlight = 0, peak = 0;
  const out = await mapPool([5, 1, 4, 2, 3], 2, async (x, i) => {
    inFlight++; peak = Math.max(peak, inFlight);
    await sleep(x);
    inFlight--;
    return `${i}:${x}`;
  });
  assert.deepEqual(out, ["0:5", "1:1", "2:4", "3:2", "4:3"]);
  assert.equal(peak, 2);
});

test("mapPool is strict: one rejection rejects the pool; an empty input resolves", async () => {
  await assert.rejects(mapPool([1, 2, 3], 3, async (x) => { if (x === 2) throw new Error("boom"); return x; }), /boom/);
  assert.deepEqual(await mapPool([], 4, async (x: number) => x), []);
  // a zero/negative cap still runs (one worker) instead of silently returning an array of undefined
  assert.deepEqual(await mapPool([1, 2], 0, async (x) => x * 2), [2, 4]);
});

test("mapPoolSafe nulls the failed slot, counts the failure, and warns once with the tally", async () => {
  resetSuppressed();
  const { result, warned } = await capturingWarn(() =>
    mapPoolSafe([1, 2, 3, 4], 3, async (x) => { if (x % 2 === 0) throw new Error(`even ${x}`); return x * 10; }, "evens"),
  );
  assert.deepEqual(result, [10, null, 30, null]);
  assert.equal(suppressedCounts().evens, 2);
  assert.ok(warned.some((w) => /\[swallowed\] evens: even/.test(w)), "first failure logged in full");
  assert.ok(warned.some((w) => /evens: 2\/4 tasks threw/.test(w)), "tally logged once");
  assert.equal(warned.filter((w) => /\[swallowed\]/.test(w)).length, 1, "only the first is logged");
});

test("swallow / quietly count per label and the exit line round-trips through parseSuppressed", async () => {
  resetSuppressed();
  await capturingWarn(async () => {
    swallow("listing", new Error("HTTP 403"));
    swallow("listing", new Error("HTTP 403"));
    assert.equal(await quietly("fetch x", async () => { throw new Error("nope"); }, "fallback"), "fallback");
    assert.equal(await quietly("fetch y", async () => 7, 0), 7);
  });
  assert.deepEqual(suppressedCounts(), { listing: 2, "fetch x": 1 });
  const line = `${SUPPRESSED_MARK} ${JSON.stringify(suppressedCounts())}`;
  const stderr = `noise\n${SUPPRESSED_MARK} {"old":1}\nmore noise\n${line}\n`;
  assert.deepEqual(parseSuppressed(stderr), { listing: 2, "fetch x": 1 }, "the last marker line wins");
  assert.equal(parseSuppressed("no marker here"), null);
  assert.equal(parseSuppressed(`${SUPPRESSED_MARK} {"cut`), null);
});

test("readJson: missing → null silently; unparseable → null but counted; absolute paths pass through", async () => {
  resetSuppressed();
  const dir = mkdtempSync(path.join(tmpdir(), "kit-"));
  try {
    writeFileSync(path.join(dir, "good.json"), JSON.stringify({ a: 1 }));
    writeFileSync(path.join(dir, "bad.json"), "{not json");
    await capturingWarn(async () => {
      assert.deepEqual(await readJson<{ a: number }>("good.json", dir), { a: 1 });
      assert.equal(await readJson("missing.json", dir), null);
      assert.equal(await readJson("bad.json", dir), null);
      assert.deepEqual(await readJson(path.join(dir, "good.json")), { a: 1 });
    });
    assert.deepEqual(suppressedCounts(), { "readJson bad.json": 1 }, "a missing file is not an error; a corrupt one is");
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test("htmlToText keeps block structure, decodes the common entities, drops scripts", () => {
  const html = `<html><head><style>p{}</style><script>x()</script></head><body><h1>Title</h1><p>A &amp; B&nbsp;&mdash; it&#8217;s &lt;ok&gt;</p><div>line<br/>two</div>\n\n\n<li>x</li></body></html>`;
  assert.equal(htmlToText(html), "Title\nA & B — it's <ok>\nline\ntwo\n\nx");
  assert.equal(htmlToText(""), "");
});

test("prompt formatters and the two user-agents", () => {
  assert.equal(pct(3.14159), "+3%");
  assert.equal(pct(-2.5, 1), "-2.5%");
  assert.equal(pct(null), "?");
  assert.equal(money(1.25e9), "$1.3B");
  assert.equal(money(340e6), "$340M");
  assert.equal(money(12_400), "$12K");
  assert.match(BROWSER_UA, /^Mozilla\/5\.0 \(Windows NT .* Chrome\/\d+/);
  assert.match(RESEARCH_UA, /tape research; .+@.+/);
});
