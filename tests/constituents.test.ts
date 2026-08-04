import { test } from "node:test";
import assert from "node:assert/strict";
import { isTickerShaped, qualifyConstituentRows, norm } from "../scripts/iwv";

// THE 2026-06-29 FREEZE: fetch-constituents picked its constituent table by "biggest wikitable whose
// headers mention Ticker AND Sector", and every one of these Wikipedia index pages carries a SECOND
// table with a Ticker column — the log of index additions/removals — whose first column is a date. On
// the S&P 400 page that changes table is 618 rows against the real list's 400, so it is the one
// "biggest wins" selects; norm() turns its dates into "JULY242026", which passes any is-there-a-letter
// check. Same bug class as the 313 date-strings f73f02c8 pulled out of the Russell 3000, except
// isDateLikeSymbol does NOT catch these (it matches three-letter month abbreviations; Wikipedia
// spells the month out). These tests pin the shape guard that separates the two tables.

test("a spelled-out date is not ticker-shaped (the strings actually observed on the changes tables)", () => {
  // Verbatim from the "Date | Added | Removed | Reason" tables, run through norm().
  for (const d of ["JULY242026", "JUNE302026", "MAY72026", "APRIL92026", "JULY12026", "JUNE22026"])
    assert.equal(isTickerShaped(d), false, `${d} must not pass as a ticker`);
});

test("real tickers — including dotted share classes — are ticker-shaped", () => {
  for (const s of ["AAPL", "F", "GOOGL", "BRK-B", "BF-B", "HONA", "SPCX", "MSFT"])
    assert.equal(isTickerShaped(s), true, `${s} must pass as a ticker`);
  // norm() maps "." → "-" first, so the Wikipedia spelling arrives already dashed.
  assert.equal(isTickerShaped(norm("BRK.B")), true);
});

test("the index-changes table is rejected outright", () => {
  // Column 0 of the changes table is the date; a handful of rows have a rowspan'd date cell, which
  // shifts a real ticker into position 0 — that is why this is a RATIO and not an all-or-nothing test.
  const changes = [
    ...["JULY242026", "JULY222026", "JULY172026", "JULY62026", "JUNE222026", "MAY182026", "APRIL92026"].map(
      (symbol) => ({ symbol }),
    ),
    { symbol: "AMD" }, // rowspan bleed-through
  ];
  assert.equal(qualifyConstituentRows(changes), null);
});

test("a genuine constituent table qualifies and keeps every row", () => {
  const members = ["ADBE", "AMD", "ABNB", "GOOGL", "GOOG", "BRK-B", "SPCX"].map((symbol) => ({ symbol }));
  const q = qualifyConstituentRows(members);
  assert.ok(q, "a 100%-shaped table must qualify");
  assert.equal(q.kept.length, members.length);
  assert.deepEqual(q.dropped, []);
});

test("junk rows inside an otherwise-good table are dropped, not admitted", () => {
  // A footnote or placeholder in one cell must not cost us the table, but must not be written either:
  // an unquotable symbol in a universe is invisible — it looks exactly like a name the index omits.
  const rows = [...Array(30)].map((_, i) => ({ symbol: `AA${String.fromCharCode(65 + (i % 26))}` }));
  rows.push({ symbol: "TBD" }, { symbol: "N-A" });
  const q = qualifyConstituentRows([...rows, { symbol: "JULY12026" }]);
  assert.ok(q, "one junk row must not disqualify a 32-row table");
  assert.deepEqual(q.dropped, ["JULY12026"]);
  assert.equal(q.kept.some((r) => r.symbol === "JULY12026"), false);
});

test("an empty table never qualifies", () => {
  assert.equal(qualifyConstituentRows([]), null);
});
