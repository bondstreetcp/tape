import { test } from "node:test";
import assert from "node:assert/strict";
import { summarizeTick, appendTickHistory, tickVerdict, dayCells, isTickHistory, isTickReport, TICK_HISTORY_MAX, type TickReport } from "../lib/tickHistory";

const report = (over: Partial<TickReport> = {}): TickReport => ({
  generatedAt: "2026-09-05T23:40:00.000Z", mode: "full", sha: "abc1234", fails: 1, total: 3,
  steps: [
    { name: "Hydrate", ok: true, exit: 0, mins: 0.4 },
    { name: "Refresh X", ok: false, exit: 1, mins: 2.5, stderrTail: "boom", suppressed: { "listing": 3, "readJson x.json": 1 } },
    { name: "Refresh Y", ok: true, exit: 0, mins: 10.1, suppressed: { yahoo: 2 } },
  ],
  ...over,
});

test("summarizeTick keeps names, exits, minutes and suppressed counts — never the stderr tail", () => {
  const e = summarizeTick(report());
  assert.equal(e.at, "2026-09-05T23:40:00.000Z");
  assert.equal(e.mins, 13);
  assert.deepEqual(e.failed, [{ name: "Refresh X", exit: 1 }]);
  assert.equal(e.suppressed, 6);
  assert.deepEqual(e.suppressedBy, { "Refresh X": 4, "Refresh Y": 2 });
  assert.ok(!JSON.stringify(e).includes("boom"), "stderr tails stay out of the public history");
  const clean = summarizeTick(report({ fails: 0, steps: [{ name: "A", ok: true, exit: 0, mins: 1 }] }));
  assert.equal(clean.suppressed, 0);
  assert.equal("suppressedBy" in clean, false);
});

test("appendTickHistory prunes past the window, dedupes a re-run, keeps oldest-first, caps the size", () => {
  const day = 86_400_000;
  const at = (offsetDays: number) => new Date(Date.parse("2026-09-05T23:40:00.000Z") + offsetDays * day).toISOString();
  const mk = (offset: number, fails = 0) => ({ ...summarizeTick(report({ generatedAt: at(offset), fails, steps: [] })), total: 3 });
  let h = appendTickHistory(null, mk(-40));
  h = appendTickHistory(h, mk(-10, 1));
  h = appendTickHistory(h, mk(0));
  assert.deepEqual(h.ticks.map((t) => t.at), [at(-10), at(0)], "the 40-day-old tick fell off");
  assert.equal(h.keepDays, 30);
  // the same report appended twice replaces, not duplicates
  h = appendTickHistory(h, { ...mk(0), fails: 2 });
  assert.equal(h.ticks.length, 2);
  assert.equal(h.ticks[1].fails, 2);
  // out-of-order append still sorts oldest first
  h = appendTickHistory(h, mk(-5));
  assert.deepEqual(h.ticks.map((t) => t.at), [at(-10), at(-5), at(0)]);
  // hard cap regardless of the window
  let big = appendTickHistory(null, mk(-29));
  for (let i = 0; i < TICK_HISTORY_MAX + 20; i++) big = appendTickHistory(big, mk(-29 + (i + 1) / 48));
  assert.equal(big.ticks.length, TICK_HISTORY_MAX);
});

test("tickVerdict: clean, partial, broken", () => {
  assert.equal(tickVerdict({ fails: 0, total: 10 }), "ok");
  assert.equal(tickVerdict({ fails: 2, total: 10 }), "partial");
  assert.equal(tickVerdict({ fails: 6, total: 10 }), "broken");
  assert.equal(tickVerdict({ fails: 1, total: 0 }), "partial");
});

test("dayCells: one cell per ET day ending on the newest tick's day, worst verdict wins, gaps are 'none'", () => {
  const mk = (at: string, fails: number, total = 4) => ({ ...summarizeTick(report({ generatedAt: at, fails, total, steps: [] })) });
  const cells = dayCells([
    mk("2026-09-01T03:00:00.000Z", 0), // Aug 31, 11pm ET
    mk("2026-09-03T15:00:00.000Z", 0),
    mk("2026-09-03T22:00:00.000Z", 1), // same ET day, partial → the day is partial
    mk("2026-09-04T23:30:00.000Z", 3), // broken
  ], 5);
  assert.deepEqual(cells.map((c) => c.day), ["2026-08-31", "2026-09-01", "2026-09-02", "2026-09-03", "2026-09-04"]);
  assert.deepEqual(cells.map((c) => c.verdict), ["ok", "none", "none", "partial", "broken"]);
  assert.deepEqual(cells[3], { day: "2026-09-03", verdict: "partial", ticks: 2, fails: 1 });
  assert.deepEqual(dayCells([], 5), []);
});

test("the file guards reject a malformed file so the page treats it as absent", () => {
  assert.equal(isTickHistory(appendTickHistory(null, summarizeTick(report()))), true);
  assert.equal(isTickHistory({ nope: true }), false);
  assert.equal(isTickHistory(null), false);
  assert.equal(isTickReport(report()), true);
  assert.equal(isTickReport({ steps: "x" }), false);
});
