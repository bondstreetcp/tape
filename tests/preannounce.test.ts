import { test } from "node:test";
import assert from "node:assert/strict";
import { isPreannouncement8K, isRecentReport8K, daysBefore, classifyReportTiming, movePreDatesReport } from "../lib/preannounce";

// A preannouncement is an 8-K Item 2.02 filed AHEAD of the scheduled print — ≥2d before (the release
// itself files ON the print date; day-before is timing noise around it) and ≤35d (the PRIOR quarter's
// earnings 8-K sits ~90d back and must never trigger). Pure calendar-square arithmetic, no Date
// roundtrips (the repo's date doctrine).

const E = "2026-08-12"; // the scheduled print (the IBM-class setup)

test("8-K Item 2.02 filed 14d ahead → preannouncement", () => {
  assert.equal(isPreannouncement8K("8-K", "2.02,9.01", "2026-07-29", E), true);
});

test("the release itself (filed ON the print date) and day-before are NOT preannouncements", () => {
  assert.equal(isPreannouncement8K("8-K", "2.02,9.01", "2026-08-12", E), false);
  assert.equal(isPreannouncement8K("8-K", "2.02", "2026-08-11", E), false);
});

test("the PRIOR quarter's earnings 8-K (~90d back) does not trigger; 35d is the cliff", () => {
  assert.equal(isPreannouncement8K("8-K", "2.02,9.01", "2026-05-13", E), false);
  assert.equal(isPreannouncement8K("8-K", "2.02", "2026-07-08", E), true); // exactly 35d
  assert.equal(isPreannouncement8K("8-K", "2.02", "2026-07-07", E), false); // 36d
});

test("non-2.02 items and non-8-K forms never trigger; 2.02 must match as a whole item", () => {
  assert.equal(isPreannouncement8K("8-K", "5.02,9.01", "2026-07-29", E), false); // leadership, not results
  assert.equal(isPreannouncement8K("10-Q", "2.02", "2026-07-29", E), false);
  assert.equal(isPreannouncement8K("8-K", undefined, "2026-07-29", E), false);
  assert.equal(isPreannouncement8K("8-K/A", "2.02", "2026-07-29", E), true); // amended 8-K counts
});

test("daysBefore is calendar-square arithmetic", () => {
  assert.equal(daysBefore("2026-07-29", "2026-08-12"), 14);
  assert.equal(daysBefore("2026-08-12", "2026-08-12"), 0);
  assert.equal(daysBefore("not-a-date", "2026-08-12"), null);
});

// ── isRecentReport8K — the Daily Desk's "did this name JUST report?" attribution fact ──

test("a results 8-K filed today or within the window marks the name as recently reported", () => {
  const T = "2026-08-08";
  assert.equal(isRecentReport8K("8-K", "2.02,9.01", "2026-08-08", T, 7), true); // reported today (ABNB case)
  assert.equal(isRecentReport8K("8-K", "2.02", "2026-08-07", T, 7), true); // yesterday
  assert.equal(isRecentReport8K("8-K", "2.02", "2026-08-01", T, 7), true); // 7d — the AKAM continuation case
  assert.equal(isRecentReport8K("8-K", "2.02", "2026-07-31", T, 7), false); // 8d — outside
});

test("non-results 8-Ks and future-dated filings never mark a report", () => {
  const T = "2026-08-08";
  assert.equal(isRecentReport8K("8-K", "5.02", "2026-08-08", T, 7), false); // leadership item
  assert.equal(isRecentReport8K("10-Q", "2.02", "2026-08-08", T, 7), false);
  assert.equal(isRecentReport8K("8-K", "2.02", "2026-08-09", T, 7), false); // future-dated
});

// ── classifyReportTiming — BMO vs AMC from EDGAR's acceptanceDateTime (genuine UTC) ──
// The fix for the DELL case: an after-close print's regular-session move pre-dates the earnings.

test("after-close (AMC) prints classify as afterhours in both DST regimes", () => {
  assert.equal(classifyReportTiming("2026-09-01T20:10:14.000Z"), "afterhours"); // DELL's real 8-K: 16:10 ET (EDT)
  assert.equal(classifyReportTiming("2026-02-26T21:08:45.000Z"), "afterhours"); // DELL winter: 16:08 ET (EST)
  assert.equal(classifyReportTiming("2026-09-01T20:00:00.000Z"), "afterhours"); // exactly 16:00 ET = the close
});

test("before-open (BMO) prints classify as premarket in both DST regimes", () => {
  assert.equal(classifyReportTiming("2026-09-01T12:30:00.000Z"), "premarket"); // 08:30 ET (EDT)
  assert.equal(classifyReportTiming("2026-02-26T12:30:00.000Z"), "premarket"); // 07:30 ET (EST)
  assert.equal(classifyReportTiming("2026-09-01T13:29:00.000Z"), "premarket"); // 09:29 ET — just before the open
});

test("mid-session accepts are intraday; the open/close are the boundaries", () => {
  assert.equal(classifyReportTiming("2026-09-01T18:00:00.000Z"), "intraday"); // 14:00 ET
  assert.equal(classifyReportTiming("2026-09-01T13:31:00.000Z"), "intraday"); // 09:31 ET — just after the open
});

test("classifyReportTiming returns null on a missing or unparseable timestamp", () => {
  assert.equal(classifyReportTiming(undefined), null);
  assert.equal(classifyReportTiming(null), null);
  assert.equal(classifyReportTiming(""), null);
  assert.equal(classifyReportTiming("not-a-timestamp"), null);
});

// ── movePreDatesReport — the session-clock decision behind the DELL fix ──
// True only when an after-close print's day IS the last completed session (its move ended pre-print).

test("an AMC print on the last completed session → the shown move pre-dates it (both desk runs)", () => {
  // Evening (post-close) run: the last session is today; DELL reported after today's close.
  assert.equal(movePreDatesReport("afterhours", "2026-09-02", "2026-09-02"), true);
  // Pre-open morning run: the last session is YESTERDAY; a print after yesterday's close still pre-dates
  // the shown (yesterday's close-to-close) move the pre-open tape hasn't reacted to.
  assert.equal(movePreDatesReport("afterhours", "2026-09-01", "2026-09-01"), true);
});

test("an AMC print from an EARLIER session is NOT pre-earnings (its reaction already traded)", () => {
  assert.equal(movePreDatesReport("afterhours", "2026-08-29", "2026-09-02"), false); // reported Fri, last session is Wed
});

test("BMO / intraday / unknown-timing prints never trip the pre-earnings caveat", () => {
  assert.equal(movePreDatesReport("premarket", "2026-09-02", "2026-09-02"), false); // before-open drove today's session
  assert.equal(movePreDatesReport("intraday", "2026-09-02", "2026-09-02"), false);
  assert.equal(movePreDatesReport(null, "2026-09-02", "2026-09-02"), false); // no timestamp → assert nothing
});
