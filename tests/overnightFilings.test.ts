import test from "node:test";
import assert from "node:assert/strict";
import { mergeCarryForward, isMassLlmFailure, type OvernightItem } from "../lib/overnightFilings";

const WIN = Date.parse("2026-07-15T00:00:00Z"); // window start
const MAX = 400;

// Minimal OvernightItem — only the fields the merge reads (accession, filedAt) matter.
const item = (accession: string, filedAt: string, headline = "x"): OvernightItem => ({
  ticker: "T", name: "T", form: "8-K", filedAt, headline, whatChanged: [], decisionTakeaway: "",
  sentiment: "neutral", surprise: "na", impact: "low", keyMetrics: {},
  riskFactorsAdded: null, riskFactorsRemoved: null, accession, url: "u",
});
const accs = (r: { items: OvernightItem[] }) => r.items.map((i) => i.accession);

test("truncated run: fresh items KEPT, prior in-window digests carried (feed doesn't shrink)", () => {
  const fresh = [item("A", "2026-07-16T14:00:00Z")]; // one freshly digested tonight
  const resolved = new Set(["A"]);
  const prior = [item("B", "2026-07-15T18:00:00Z"), item("C", "2026-07-15T12:00:00Z")]; // not reached tonight
  const r = mergeCarryForward(fresh, resolved, prior, WIN, MAX);
  assert.equal(r.carried, 2);
  assert.deepEqual(accs(r), ["A", "B", "C"]); // newest-first, nothing lost
});

test("NONE-gated accession is NOT carried (a definitive drop must stick)", () => {
  // B was in last night's file; tonight we re-evaluated it and the LLM said NONE → it must disappear.
  const fresh: OvernightItem[] = [];
  const resolved = new Set(["B"]); // B resolved this run (to NONE)
  const prior = [item("B", "2026-07-15T18:00:00Z")];
  const r = mergeCarryForward(fresh, resolved, prior, WIN, MAX);
  assert.equal(r.carried, 0);
  assert.deepEqual(accs(r), []);
});

test("transient failure (LLM/unreadable): accession NOT in resolved → prior digest survives", () => {
  // B failed at the LLM tonight (not in `resolved`); its good prior digest must be carried, not dropped.
  const r = mergeCarryForward([], new Set(), [item("B", "2026-07-15T18:00:00Z")], WIN, MAX);
  assert.deepEqual(accs(r), ["B"]);
});

test("fresh digest WINS over a carried duplicate of the same accession", () => {
  const fresh = [item("A", "2026-07-16T10:00:00Z", "fresh")];
  const prior = [item("A", "2026-07-16T10:00:00Z", "stale")];
  const r = mergeCarryForward(fresh, new Set(["A"]), prior, WIN, MAX);
  assert.equal(r.items.length, 1);
  assert.equal(r.items[0].headline, "fresh");
});

test("prior items that aged OUT of the window are dropped", () => {
  const prior = [item("OLD", "2026-07-14T23:59:00Z"), item("IN", "2026-07-15T01:00:00Z")];
  const r = mergeCarryForward([], new Set(), prior, WIN, MAX);
  assert.deepEqual(accs(r), ["IN"]); // OLD is before windowStart
});

test("duplicate accessions WITHIN prior are de-duped (carried once)", () => {
  const prior = [item("B", "2026-07-15T18:00:00Z"), item("B", "2026-07-15T09:00:00Z")];
  const r = mergeCarryForward([], new Set(), prior, WIN, MAX);
  assert.equal(r.items.length, 1);
});

test("junk filedAt / missing accession in prior is skipped, not thrown on", () => {
  const prior = [
    { ...item("B", "not-a-date") },
    { ...item("", "2026-07-16T00:00:00Z") },
    item("GOOD", "2026-07-16T00:00:00Z"),
  ];
  const r = mergeCarryForward([], new Set(), prior, WIN, MAX);
  assert.deepEqual(accs(r), ["GOOD"]);
});

test("output is newest-first and capped at maxItems", () => {
  const fresh = Array.from({ length: 5 }, (_, i) => item(`F${i}`, `2026-07-16T0${i}:00:00Z`));
  const prior = Array.from({ length: 5 }, (_, i) => item(`P${i}`, `2026-07-15T0${i}:00:00Z`));
  const r = mergeCarryForward(fresh, new Set(fresh.map((f) => f.accession)), prior, WIN, 3);
  assert.equal(r.items.length, 3);
  // the 3 newest overall are the top fresh ones
  assert.deepEqual(accs(r), ["F4", "F3", "F2"]);
});

test("empty everything → empty, no throw (first run, nothing detected)", () => {
  const r = mergeCarryForward([], new Set(), [], WIN, MAX);
  assert.deepEqual(r.items, []);
  assert.equal(r.carried, 0);
});

// ── isMassLlmFailure — the guard the review found budget-truncation could defeat ────────────────
test("mass-failure guard: THE review bug — a truncated run with a hanging LLM must still fire", () => {
  // attempted=4 (<5, budget cut the rest), all 4 failed, deferred>0 → the OLD `attempted>=5` floor
  // skipped this and masked the outage. Now deferred>0 bypasses the floor.
  assert.equal(isMassLlmFailure(4, 4, 30), true);
  assert.equal(isMassLlmFailure(2, 2, 50), true); // even smaller sample, still truncated
  assert.equal(isMassLlmFailure(1, 1, 90), true);
});

test("mass-failure guard: a genuinely QUIET, fully-processed night does NOT false-alarm", () => {
  // Small sample but deferred=0 (we finished) → the floor applies, a 1-of-2 blip is tolerated.
  assert.equal(isMassLlmFailure(2, 1, 0), false);
  assert.equal(isMassLlmFailure(4, 4, 0), false); // 100% but <5 and not truncated — still a fluke-guard
  assert.equal(isMassLlmFailure(3, 0, 0), false); // nothing failed
});

test("mass-failure guard: healthy full runs unchanged (floor path preserved)", () => {
  assert.equal(isMassLlmFailure(40, 1, 0), false); // 2.5% fail
  assert.equal(isMassLlmFailure(10, 3, 0), false); // exactly 30% — not > 30%
  assert.equal(isMassLlmFailure(10, 4, 0), true); // 40% on a full sample → fires (original behavior)
  assert.equal(isMassLlmFailure(5, 2, 0), true); // 40%, at the floor → fires
});

test("mass-failure guard: a heavy but HEALTHY truncated night (low fail rate) does NOT fire", () => {
  // deferred>0 because there was a lot to summarize, but the LLM is fine → must not cry outage.
  assert.equal(isMassLlmFailure(30, 1, 20), false);
  assert.equal(isMassLlmFailure(0, 0, 100), false); // detection ate the whole budget — nothing attempted
});
