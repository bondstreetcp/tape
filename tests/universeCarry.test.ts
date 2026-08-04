import { test } from "node:test";
import assert from "node:assert/strict";
import { carryForwardRows, coverageShortfall, todayISO, type CarryableRow } from "../lib/universeCarry";
import { isDateLikeSymbol, CLASS_SYMBOL_FIXUPS } from "../scripts/iwv";

// The 2026-07-30 incident this module exists for: the Russell 3000 snapshot held 2,228 of 2,593 real
// constituents. 365 names — MTCH, HUM, LNG, DVN, MTD — were silently absent, and re-probing found
// most of them fetching fine hours later. They were dropped by a transient vendor failure, and
// nothing noticed because the write-guard only compares night-to-night.

interface Row extends CarryableRow { symbol: string; price: number; staleSince?: string | null }
const R = (symbol: string, price: number, staleSince?: string | null): Row => ({ symbol, price, staleSince });
const M = (rows: Row[]) => new Map(rows.map((r) => [r.symbol, r]));
const NOW = Date.parse("2026-07-30T12:00:00Z");

test("a fresh fetch is used as-is", () => {
  const out = carryForwardRows(["MTCH"], M([R("MTCH", 40.54)]), M([]), { nowMs: NOW });
  assert.deepEqual(out.fresh, ["MTCH"]);
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].price, 40.54);
});

test("THE BUG: a listed name that fails to fetch is CARRIED, not dropped", () => {
  const out = carryForwardRows(["MTCH"], M([]), M([R("MTCH", 39.10)]), { nowMs: NOW });
  assert.deepEqual(out.carried, ["MTCH"], "MTCH must survive a failed fetch");
  assert.equal(out.rows.length, 1);
  assert.equal(out.rows[0].price, 39.10, "serves the prior price");
  assert.equal(out.rows[0].staleSince, "2026-07-30", "and is stamped so the staleness is visible");
});

test("the stale stamp is set ONCE — the window measures real unreachability, not the last attempt", () => {
  // Failed for the first time three days ago; tonight's failure must not reset the clock.
  const prior = M([R("MTCH", 39.10, "2026-07-27")]);
  const out = carryForwardRows(["MTCH"], M([]), prior, { nowMs: NOW });
  assert.equal(out.rows[0].staleSince, "2026-07-27");
  assert.deepEqual(out.carried, ["MTCH"]);
});

test("a recovered fetch CLEARS the stale stamp — recovery is automatic", () => {
  const out = carryForwardRows(["MTCH"], M([R("MTCH", 40.54)]), M([R("MTCH", 39.10, "2026-07-27")]), { nowMs: NOW });
  assert.deepEqual(out.fresh, ["MTCH"]);
  // Absent or null both mean "current"; a fresh row simply never carries the key, so JSON.stringify
  // omits it and healthy rows cost nothing. What must NOT survive is the old date.
  assert.ok(!out.rows[0].staleSince, `expected no stale stamp, got ${out.rows[0].staleSince}`);
  assert.equal(out.rows[0].price, 40.54);
});

test("a fresh row arriving WITH a stamp still gets it cleared (defensive)", () => {
  const out = carryForwardRows(["X"], M([R("X", 5, "2026-07-01")]), M([]), { nowMs: NOW });
  assert.equal(out.rows[0].staleSince, null);
});

test("the carry is BOUNDED — past maxCarryDays a name is dropped for real", () => {
  // Genuinely delisted 20 days ago: must not live forever as a ghost row.
  const out = carryForwardRows(["DEAD"], M([]), M([R("DEAD", 1.0, "2026-07-10")]), { nowMs: NOW, maxCarryDays: 7 });
  assert.deepEqual(out.expired, ["DEAD"]);
  assert.equal(out.rows.length, 0);
});

test("exactly at the boundary the row is still carried (> not >=)", () => {
  const out = carryForwardRows(["X"], M([]), M([R("X", 1, "2026-07-23")]), { nowMs: NOW, maxCarryDays: 7 });
  assert.deepEqual(out.carried, ["X"], "7 days old with maxCarryDays=7 is still within the window");
  const past = carryForwardRows(["X"], M([]), M([R("X", 1, "2026-07-22")]), { nowMs: NOW, maxCarryDays: 7 });
  assert.deepEqual(past.expired, ["X"], "8 days is outside it");
});

test("a name with no fresh row and no prior row is 'unknown', not an error", () => {
  const out = carryForwardRows(["NEWIPO"], M([]), M([]), { nowMs: NOW });
  assert.deepEqual(out.unknown, ["NEWIPO"]);
  assert.equal(out.rows.length, 0);
});

test("output follows the INDEX order and de-duplicates", () => {
  const fresh = M([R("B", 2), R("A", 1)]);
  const out = carryForwardRows(["A", "B", "A"], fresh, M([]), { nowMs: NOW });
  assert.deepEqual(out.rows.map((r) => r.symbol), ["A", "B"]);
  assert.deepEqual(out.fresh, ["A", "B"]);
});

test("a prior row for a name NO LONGER in the index is not resurrected", () => {
  // Index removal is authoritative — carry-forward must never re-add a deleted constituent.
  const out = carryForwardRows(["A"], M([R("A", 1)]), M([R("A", 1), R("REMOVED", 9)]), { nowMs: NOW });
  assert.deepEqual(out.rows.map((r) => r.symbol), ["A"]);
});

test("the real incident, in miniature: 3 of 4 fail, all 4 survive", () => {
  const listed = ["MTCH", "HUM", "LNG", "AAPL"];
  const fresh = M([R("AAPL", 250)]);
  const prior = M([R("MTCH", 39.1), R("HUM", 374.5), R("LNG", 258.08), R("AAPL", 249)]);
  const out = carryForwardRows(listed, fresh, prior, { nowMs: NOW });
  assert.equal(out.rows.length, 4, "the universe keeps its breadth through a bad vendor night");
  assert.deepEqual(out.carried, ["MTCH", "HUM", "LNG"]);
  assert.deepEqual(out.fresh, ["AAPL"]);
});

// ── the absolute coverage check the relative guard cannot do ──────────────────────────────────────
test("coverageShortfall measures against the INDEX, not against last night", () => {
  const s = coverageShortfall(2228, 2593);
  assert.equal(s.missing, 365);
  assert.ok(Math.abs(s.shortfall - 0.1408) < 0.001);
  assert.equal(s.ok, false, "14% short of the index must not pass a 5% tolerance");
});

test("coverageShortfall passes a healthy build and tolerates zero/absent expectations", () => {
  assert.equal(coverageShortfall(998, 1003).ok, true, "0.5% short is fine");
  assert.equal(coverageShortfall(0, 0).ok, true);
  assert.equal(coverageShortfall(100, 0).ok, true, "unknown expectation cannot fail the build");
  assert.equal(coverageShortfall(3000, 2593).missing, 0, "a surplus is not a shortfall");
});

test("todayISO is a bare calendar day", () => {
  assert.equal(todayISO(NOW), "2026-07-30");
});

// ── the IWV parser junk that inflated the expected count ──────────────────────────────────────────
test("date strings from the holdings export are rejected as tickers", () => {
  for (const junk of ["APR302001", "FEB292016", "DEC312000", "MAR312026", "JUL312023", "20260430"])
    assert.equal(isDateLikeSymbol(junk), true, `${junk} must be rejected`);
});

test("real tickers that LOOK date-ish are not rejected", () => {
  // Month-rooted and short numeric symbols are real; over-matching here would delete live names.
  for (const real of ["MAY", "JUN", "MARA", "APRN", "DEC", "AUGX", "SEPN", "M", "V", "BRK-B", "T", "F", "3M"])
    assert.equal(isDateLikeSymbol(real), false, `${real} must survive`);
});

// ── the share-class spelling mismatch that hid Berkshire ─────────────────────────────────────────
test("share classes Yahoo dashes are re-spelled", () => {
  // iShares writes BRKB; every price/chart/screen here needs BRK-B. Verified by quoting both.
  assert.equal(CLASS_SYMBOL_FIXUPS.BRKB, "BRK-B");
  assert.equal(CLASS_SYMBOL_FIXUPS.HEIA, "HEI-A");
  assert.equal(CLASS_SYMBOL_FIXUPS.LENB, "LEN-B");
  assert.equal(CLASS_SYMBOL_FIXUPS.UHALB, "UHAL-B");
});

test("SHARE-CLASS SAFETY: symbols already correct unseparated are NEVER rewritten", () => {
  // The tempting "name says CLASS A + symbol ends in A ⇒ insert a dash" rule was measured against the
  // live holdings file: 27 of 34 matches were already correct, and two would have become a DIFFERENT
  // company — META→MET-A is MetLife, MA→M-A is Mastercard. This is the regression that guards it.
  for (const keep of ["META", "MA", "NWSA", "FOXA", "UAA", "LBTYA", "CENTA", "RUSHA", "RUSHB",
                      "VERA", "BETA", "VIA", "CMCSA", "OKTA", "ZBRA", "KELYA", "ATROB", "IMKTA"])
    assert.equal(CLASS_SYMBOL_FIXUPS[keep], undefined, `${keep} must NOT be re-spelled`);
});

test("every fixup maps an unseparated symbol to a dashed one of the same root", () => {
  for (const [from, to] of Object.entries(CLASS_SYMBOL_FIXUPS)) {
    assert.equal(from.includes("-"), false, `${from} should be the unseparated spelling`);
    assert.equal(to, `${from.slice(0, -1)}-${from.slice(-1)}`, `${from} → ${to} must only insert a dash`);
  }
});
