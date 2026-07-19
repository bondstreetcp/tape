import { test } from "node:test";
import assert from "node:assert/strict";
import { eventResolved, classRoot } from "../lib/corpEvents";

// The trade-log's catalyst overlay drops tickers whose most recent event reads RESOLVED and joins
// EDGAR's first-listed share class onto the snapshot's traded class via the root. Both are regex-level
// judgments over LLM prose, so pin the real headlines (from data/corp-events.json) they must handle.

test("eventResolved: completed/concluded/finalized events match", () => {
  assert.ok(eventResolved("Middleby completed spin-off of its food processing business, Midera Foods"));
  assert.ok(eventResolved("S&P Global completes spin-off of Mobility Global Inc. (MBGL) on July 1"));
  assert.ok(eventResolved("Braemar concludes strategic review — will remain publicly traded"));
  assert.ok(eventResolved("FedEx spin-off of its freight unit finalized June 1, 2026"));
  assert.ok(eventResolved("Company terminates its review of strategic alternatives"));
});

test("eventResolved: signed definitive deals match (review is over; IV pins to the deal)", () => {
  assert.ok(eventResolved("Entered into a definitive merger agreement to be acquired by XYZ Corp"));
  assert.ok(eventResolved("Signs definitive agreement for the sale of the company at $24.00/sh"));
  assert.ok(eventResolved("Agrees to be acquired by ABC Holdings for $2.1bn"));
});

test("eventResolved: LIVE events must NOT match — esp. the 'on track for completion' trap", () => {
  // The verb-anchor exists for THIS case: a spin still in motion whose headline contains the noun
  // "completion" (the MIDD 06-29 headline) must stay flagged; only past-tense verbs mean resolved.
  assert.ok(!eventResolved("Middleby spin-off of Midera Foods on track for completion July 6, 2026"));
  assert.ok(!eventResolved("Board authorizes review of strategic alternatives"));
  assert.ok(!eventResolved("Resideo sets record date of July 20, 2026 and distribution date of Aug 1"));
  assert.ok(!eventResolved("Exploring strategic alternatives including financings, recapitalization"));
  assert.ok(!eventResolved("Evaluating strategic alternatives to fund ~$52.1M of obligations"));
});

test("classRoot: strips a single-letter share class, normalizes dot to dash, passes plain symbols", () => {
  assert.equal(classRoot("BRK-B"), "BRK");
  assert.equal(classRoot("BF.A"), "BF");
  assert.equal(classRoot("bf-a"), "BF"); // case-normalizes too — the overlay joins uppercase
  assert.equal(classRoot("MOG-A"), "MOG");
  assert.equal(classRoot("GOOG"), "GOOG"); // no class suffix → unchanged
  assert.equal(classRoot("REZI"), "REZI");
});
