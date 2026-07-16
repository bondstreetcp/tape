import test from "node:test";
import assert from "node:assert/strict";
import { instantFrameIds, isDueByFiling, cikKey, seenEndFromFacts, INVISIBLE_MAX_AGE_DAYS, RESTATEMENT_CEILING_DAYS } from "../lib/secFrames";

const at = (iso: string) => Date.parse(iso);
const daysAgo = (n: number, nowMs: number) => new Date(nowMs - n * 86_400_000).toISOString().slice(0, 10);
// Midnight UTC, deliberately: ageDays() rounds (now − date@00:00Z), so a noon NOW would add a
// half-day and shift every day-boundary assertion by one. The library's rounding is fine
// operationally; the tests just need exact integers to pin the boundaries.
const NOW = at("2026-07-16T00:00:00Z");

// ── instantFrameIds ───────────────────────────────────────────────────────────────────────────
test("instantFrameIds: starts at the CURRENT calendar quarter and walks back", () => {
  // Mid-July = Q3. The Q3I frame is near-empty this early (nothing has a Jul-Sep balance-sheet
  // date yet) — that's fine, it 404s/skips harmlessly and matters in September. The lookback must
  // still reach Q4 of LAST year, else a name whose latest filed end was late-Dec goes invisible.
  assert.deepEqual(instantFrameIds(NOW, 4), ["CY2026Q3I", "CY2026Q2I", "CY2026Q1I", "CY2025Q4I"]);
});

test("instantFrameIds: year boundary walks into the prior year correctly", () => {
  assert.deepEqual(instantFrameIds(at("2026-01-05T00:00:00Z"), 4), ["CY2026Q1I", "CY2025Q4I", "CY2025Q3I", "CY2025Q2I"]);
});

test("instantFrameIds: quarter edges (Mar 31 is Q1, Apr 1 is Q2 — UTC)", () => {
  assert.equal(instantFrameIds(at("2026-03-31T23:00:00Z"), 1)[0], "CY2026Q1I");
  assert.equal(instantFrameIds(at("2026-04-01T01:00:00Z"), 1)[0], "CY2026Q2I");
});

// ── cikKey ────────────────────────────────────────────────────────────────────────────────────
test("cikKey: numbers, padded strings, and bare strings all canonicalize identically", () => {
  assert.equal(cikKey(320193), "320193");
  assert.equal(cikKey("0000320193"), "320193");
  assert.equal(cikKey("320193"), "320193");
});

// ── isDueByFiling — the table the whole migration hangs on ───────────────────────────────────
test("due: never-cached name is always due", () => {
  assert.equal(isDueByFiling(undefined, "2026-06-30", NOW), true);
  assert.equal(isDueByFiling(undefined, undefined, NOW), true);
});

test("due: they FILED — frameEnd newer than seenEnd", () => {
  const e = { fetchedAt: daysAgo(2, NOW), seenEnd: "2026-03-31", asOf: "2026-03-31" };
  assert.equal(isDueByFiling(e, "2026-06-30", NOW), true);
});

test("not due: frameEnd equals seenEnd — we already ingested that filing (the idempotency loop)", () => {
  const e = { fetchedAt: daysAgo(2, NOW), seenEnd: "2026-06-30", asOf: "2026-03-31" };
  assert.equal(isDueByFiling(e, "2026-06-30", NOW), false);
});

test("seed-entry fallback: no seenEnd → asOf is the baseline (pre-migration entries self-heal)", () => {
  // The committed buybacks seed predates seenEnd. Its asOf must serve as the baseline so the
  // first post-migration night doesn't re-pull all 500 names.
  const quiet = { fetchedAt: daysAgo(1, NOW), asOf: "2026-06-30" };
  assert.equal(isDueByFiling(quiet, "2026-06-30", NOW), false);
  const filedSince = { fetchedAt: daysAgo(1, NOW), asOf: "2026-03-31" };
  assert.equal(isDueByFiling(filedSince, "2026-04-30", NOW), true);
});

test("no baseline at all: due (can't prove freshness) — the pull then stamps seenEnd", () => {
  assert.equal(isDueByFiling({ fetchedAt: daysAgo(1, NOW), asOf: null }, "2026-06-30", NOW), true);
});

test("restatement ceiling: a filing-quiet name still re-pulls ~monthly (amendments move values, not ends)", () => {
  const base = { seenEnd: "2026-03-31", asOf: "2026-03-31" };
  assert.equal(isDueByFiling({ ...base, fetchedAt: daysAgo(RESTATEMENT_CEILING_DAYS - 1, NOW) }, "2026-03-31", NOW), false);
  assert.equal(isDueByFiling({ ...base, fetchedAt: daysAgo(RESTATEMENT_CEILING_DAYS, NOW) }, "2026-03-31", NOW), true);
});

test("invisible to the detector: falls back to the legacy blanket age rule", () => {
  const e = { fetchedAt: daysAgo(INVISIBLE_MAX_AGE_DAYS - 1, NOW), seenEnd: "2026-03-31", asOf: "2026-03-31" };
  assert.equal(isDueByFiling(e, undefined, NOW), false);
  const stale = { ...e, fetchedAt: daysAgo(INVISIBLE_MAX_AGE_DAYS, NOW) };
  assert.equal(isDueByFiling(stale, undefined, NOW), true);
});

// ── seenEndFromFacts ──────────────────────────────────────────────────────────────────────────
test("seenEndFromFacts: newest us-gaap Assets end — the SAME concept the detector frames carry", () => {
  const j = { facts: { "us-gaap": { Assets: { units: { USD: [
    { end: "2025-12-31", val: 1 }, { end: "2026-06-30", val: 3 }, { end: "2026-03-31", val: 2 }, { val: 9 },
  ] } } } } };
  assert.equal(seenEndFromFacts(j), "2026-06-30");
  assert.equal(seenEndFromFacts({}), null);
  assert.equal(seenEndFromFacts({ facts: { "us-gaap": {} } }), null);
});
