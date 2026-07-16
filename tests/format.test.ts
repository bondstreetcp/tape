// ⚠ Must be set before anything constructs a Date/Intl formatter. `node --test` runs each test file
// in its own process, so this cannot leak into the rest of the suite.
process.env.TZ = "America/Los_Angeles";

import test from "node:test";
import assert from "node:assert/strict";
import { fmtDate } from "../lib/format";

const EXPIRY = "2026-08-21"; // a real Friday option expiry — a bare CALENDAR date
const INSTANT = "2026-08-04T12:30:00.000Z"; // a real earnings timestamp — 5:30am in LA

test("the test process really is west of Greenwich (else everything below is vacuous)", () => {
  // Guard: in a UTC CI box the naive formatting is accidentally correct, so these tests would pass
  // while the bug they exist to catch sails through. Fail loudly instead of pretending to pass.
  assert.equal(Intl.DateTimeFormat().resolvedOptions().timeZone, "America/Los_Angeles");
  assert.equal(
    new Date(EXPIRY + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    "Aug 20",
    "the naive pattern must be demonstrably WRONG here — that's the whole premise",
  );
});

test("fmtDate: a bare YYYY-MM-DD keeps its calendar day west of Greenwich", () => {
  // The bug this pins: `new Date("2026-08-21" + "T00:00:00Z").toLocaleDateString(undefined, ...)`
  // is UTC midnight rendered LOCALLY ⇒ "Aug 20". A Friday expiry displayed as Thursday, on three
  // options screeners at once. fmtDate detects the bare day and pins the render to UTC.
  assert.equal(fmtDate(EXPIRY, { year: false }), "Aug 21");
  assert.equal(fmtDate(EXPIRY), "Aug 21, 2026");
});

test("fmtDate: a real ISO instant still renders in LOCAL time", () => {
  // The other half of the distinction — an instant is a moment, not a calendar square. 12:30Z is
  // 5:30am the SAME day in LA, so the day is unchanged, but the local basis is what's wanted.
  assert.equal(fmtDate(INSTANT, { year: false }), "Aug 4");
});

test("fmtDate: an instant that falls on the PRIOR local day renders as that prior day", () => {
  // 2026-08-05T03:00Z is 8pm on Aug 4 in LA. Local is correct for an instant — this is exactly why
  // fmtDate can't just pin everything to UTC, and why the bare-day branch has to exist.
  assert.equal(fmtDate("2026-08-05T03:00:00.000Z", { year: false }), "Aug 4");
});

test("fmtDate: Date objects and epoch ms are instants, not calendar days", () => {
  assert.equal(fmtDate(new Date("2026-08-05T03:00:00.000Z"), { year: false }), "Aug 4");
  assert.equal(fmtDate(Date.parse("2026-08-05T03:00:00.000Z"), { year: false }), "Aug 4");
});

test("fmtDate: junk degrades to the input rather than 'Invalid Date'", () => {
  assert.equal(fmtDate("not a date"), "not a date");
  assert.equal(fmtDate(""), "");
});

test("fmtDate: year-end bare date doesn't roll back into the prior year", () => {
  // The nastiest form of this bug: Jan 1 rendering as Dec 31 of the PREVIOUS year.
  assert.equal(fmtDate("2027-01-01"), "Jan 1, 2027");
});
