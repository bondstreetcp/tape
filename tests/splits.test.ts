import test from "node:test";
import assert from "node:assert/strict";
import { mergeSplitLedger, splitsFromYahoo, type SplitEvent, type SplitLedgerFile } from "../lib/splits";

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-15T21:30:00Z"); // a real run happens mid-evening, not at UTC midnight
const day = (d: string) => Date.parse(d + "T00:00:00Z");

const ledger = (splits: Record<string, SplitEvent[]>): SplitLedgerFile =>
  ({ generatedAt: "2026-07-14T23:00:00Z", splits });

test("ledger: MERGES — a symbol Yahoo dropped tonight keeps its known splits", () => {
  const prev = ledger({ AAA: [{ date: day("2026-07-01"), priceMult: 0.1 }] });
  // tonight only BBB came back; AAA's chart fetch threw ⇒ no key for AAA
  const out = mergeSplitLedger(prev, new Map([["BBB", [{ date: day("2026-07-02"), priceMult: 2 }]]]), NOW);
  assert.deepEqual(out.splits.AAA, [{ date: day("2026-07-01"), priceMult: 0.1 }], "must not lose AAA");
  assert.deepEqual(out.splits.BBB, [{ date: day("2026-07-02"), priceMult: 2 }]);
});

test("ledger: an OBSERVED symbol with no splits doesn't erase a prior split", () => {
  // Yahoo retracting a split it once reported is a vendor glitch, not a fact. Union semantics:
  // the split may already be folded into the log, and un-applying it is impossible.
  const prev = ledger({ AAA: [{ date: day("2026-07-01"), priceMult: 0.1 }] });
  const out = mergeSplitLedger(prev, new Map([["AAA", []]]), NOW);
  assert.equal(out.splits.AAA.length, 1);
});

test("ledger: the date key is FLOORED to the UTC day and is stable run-to-run", () => {
  // The whole idempotency chain hangs off this: signalLog stores `date` in splitAdj, so a vendor
  // timestamp that drifts by hours between runs would read as a NEW split and double-apply.
  const a = mergeSplitLedger(null, new Map([["AAA", [{ date: day("2026-07-01") + 13.5 * 3600_000, priceMult: 0.1 }]]]), NOW);
  const b = mergeSplitLedger(null, new Map([["AAA", [{ date: day("2026-07-01") + 20 * 3600_000, priceMult: 0.1 }]]]), NOW);
  assert.equal(a.splits.AAA[0].date, day("2026-07-01"));
  assert.deepEqual(a.splits.AAA, b.splits.AAA, "same calendar day ⇒ byte-identical key");
});

test("ledger: same-day duplicates collapse; first observation wins", () => {
  const prev = ledger({ AAA: [{ date: day("2026-07-01"), priceMult: 0.1 }] });
  const out = mergeSplitLedger(prev, new Map([["AAA", [{ date: day("2026-07-01") + 3600_000, priceMult: 0.1 }]]]), NOW);
  assert.equal(out.splits.AAA.length, 1, "re-observing the same split must not duplicate it");
});

test("ledger: entries older than the window age out; the window is measured from today", () => {
  const prev = ledger({
    AAA: [{ date: day("2026-07-01"), priceMult: 0.1 }, { date: NOW - 500 * DAY, priceMult: 4 }],
  });
  const out = mergeSplitLedger(prev, new Map(), NOW);
  assert.equal(out.splits.AAA.length, 1);
  assert.equal(out.splits.AAA[0].date, day("2026-07-01"));
});

test("ledger: a symbol whose every split ages out drops from the file entirely", () => {
  const out = mergeSplitLedger(ledger({ OLD: [{ date: NOW - 900 * DAY, priceMult: 2 }] }), new Map(), NOW);
  assert.equal(out.splits.OLD, undefined);
  assert.deepEqual(Object.keys(out.splits), []);
});

test("ledger: junk ratios and unparseable dates are dropped, not persisted", () => {
  const out = mergeSplitLedger(null, new Map([["AAA", [
    { date: day("2026-07-01"), priceMult: 0 },        // nonsense
    { date: day("2026-07-02"), priceMult: -1 },       // nonsense
    { date: NaN, priceMult: 2 },                      // unparseable
    { date: day("2026-07-03"), priceMult: 0.25 },     // good
  ] as SplitEvent[]]]), NOW);
  assert.deepEqual(out.splits.AAA, [{ date: day("2026-07-03"), priceMult: 0.25 }]);
});

test("ledger: output is sorted ascending and the first run is fully populated", () => {
  // No bootstrap gap: Yahoo's chart carries ~5.5y of split history, so night one already knows
  // every split in the window.
  const out = mergeSplitLedger(null, new Map([["AAA", [
    { date: day("2026-06-01"), priceMult: 2 },
    { date: day("2026-01-05"), priceMult: 0.1 },
    { date: day("2026-03-09"), priceMult: 0.5 },
  ]]]), NOW);
  assert.deepEqual(out.splits.AAA.map((s) => s.date), [day("2026-01-05"), day("2026-03-09"), day("2026-06-01")]);
  assert.equal(out.generatedAt, new Date(NOW).toISOString());
});

test("ledger: empty in, empty out (no prior, nothing observed)", () => {
  const out = mergeSplitLedger(null, new Map(), NOW);
  assert.deepEqual(out.splits, {});
});

test("splitsFromYahoo: the shape build-data actually feeds the ledger", () => {
  // yahoo-finance2 hands back events.splits keyed by timestamp, dates in SECONDS.
  const evts = {
    splits: {
      "1767571200": { date: 1767571200, numerator: 10, denominator: 1, splitRatio: "10:1" },
      "1751328000": { date: 1751328000, numerator: 1, denominator: 2, splitRatio: "1:2" },
    },
  };
  const out = splitsFromYahoo(evts);
  assert.equal(out.length, 2);
  assert.ok(out[0].date < out[1].date, "ascending");
  assert.equal(out[1].priceMult, 0.1, "forward 10-for-1 ⇒ pre-split closes ×0.1");
  assert.equal(out[0].priceMult, 2, "reverse 1-for-2 ⇒ pre-split closes ×2");
});
