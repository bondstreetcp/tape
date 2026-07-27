import { test } from "node:test";
import assert from "node:assert/strict";
import { selectDeskActions, actionVerb, isRatingChange, signalTier, type DeskAction } from "../lib/deskAnalyst";

// Regression suite for a bug that shipped and MISLED: the desk note filtered analyst actions to
// `up || down` and then took `.slice(0, 12)`. Rating changes are rare, so the slice reached back six
// days to fill itself and the brief narrated week-old downgrades as today's news.
//
// Case 1 is the real 2026-07-27 sp500 tape, reproduced from the live API: 17 actions that day, ZERO
// up/down, and the cumulative up/down count not reaching 12 until 07-21.

const A = (date: string, symbol: string, action: string, targetTo: number | null = null): DeskAction =>
  ({ date, symbol, action, firm: "Firm", fromGrade: "Hold", toGrade: "Buy", targetTo });

/** Calendar-day age relative to a fixed "today", matching what daysUntil gives the real caller. */
const ageFrom = (today: string) => (iso: string) =>
  Math.round((Date.parse(today + "T00:00:00Z") - Date.parse(iso + "T00:00:00Z")) / 86_400_000);

test("THE BUG: a day with zero rating changes still reports THAT day, not last week's", () => {
  const age = ageFrom("2026-07-27");
  const all: DeskAction[] = [
    // 2026-07-27: plenty of real activity, none of it an up/down — the shape that broke it
    A("2026-07-27", "MSFT", "reit", 586),
    A("2026-07-27", "AMD", "main", 600),
    A("2026-07-27", "INTC", "main", 125),
    A("2026-07-27", "HD", "main", 377),
    // …and six days back, the up/downgrades the old slice reached for
    A("2026-07-21", "SO", "down", 79),
    A("2026-07-21", "T", "up", 29),
  ];
  const picked = selectDeskActions(all, age, { windowDays: 4, max: 12 });

  assert.ok(picked.length > 0, "must not come back empty just because nothing was upgraded");
  assert.equal(picked.every((a) => age(a.date) <= 4), true, "nothing outside the window may appear");
  assert.equal(picked.some((a) => a.date === "2026-07-21"), false, "the six-day-old downgrade must be GONE");
  assert.equal(picked[0].date, "2026-07-27", "a daily desk leads with today");
  assert.deepEqual(picked.map((a) => a.symbol).sort(), ["AMD", "HD", "INTC", "MSFT"]);
});

test("the old approach is what this replaces — filter+slice reaches arbitrarily far back", () => {
  // Pin the failure explicitly so nobody reintroduces it as a "simplification".
  const all: DeskAction[] = [
    A("2026-07-27", "MSFT", "main", 586),
    A("2026-07-21", "SO", "down", 79),
  ];
  const oldWay = all.filter((a) => a.action === "up" || a.action === "down").slice(0, 12);
  assert.deepEqual(oldWay.map((a) => a.date), ["2026-07-21"], "old logic surfaces ONLY the stale item");
  const newWay = selectDeskActions(all, ageFrom("2026-07-27"), { windowDays: 4 });
  assert.deepEqual(newWay.map((a) => a.date), ["2026-07-27"], "new logic surfaces the day's actual tape");
});

test("rating changes get reserved slots — a busy day of maintains cannot crowd them out", () => {
  const age = ageFrom("2026-07-27");
  const all: DeskAction[] = [
    ...Array.from({ length: 30 }, (_, i) => A("2026-07-27", `M${i}`, "main", 100 + i)),
    A("2026-07-26", "PGR", "up", 210),
    A("2026-07-26", "SO", "down", 79),
  ];
  const picked = selectDeskActions(all, age, { windowDays: 4, max: 12, reserveChanges: 6 });
  assert.equal(picked.length, 12);
  const changes = picked.filter(isRatingChange).map((a) => a.symbol).sort();
  assert.deepEqual(changes, ["PGR", "SO"], "both real rating changes survive 30 competing maintains");
});

test("a maintain WITHOUT a price target says nothing and is dropped; with one it qualifies", () => {
  const age = ageFrom("2026-07-27");
  const picked = selectDeskActions(
    [A("2026-07-27", "NOPT", "main", null), A("2026-07-27", "HASPT", "main", 100)],
    age, { windowDays: 4 });
  assert.deepEqual(picked.map((a) => a.symbol), ["HASPT"]);
});

test("…but a rating CHANGE qualifies even with no price target", () => {
  const picked = selectDeskActions([A("2026-07-27", "UPNOPT", "up", null)], ageFrom("2026-07-27"), { windowDays: 4 });
  assert.deepEqual(picked.map((a) => a.symbol), ["UPNOPT"]);
});

test("the window spans a weekend — Monday's desk still sees Friday", () => {
  // Fri 2026-07-24 -> Mon 2026-07-27 is 3 calendar days; a 1-day window would blank the section.
  const picked = selectDeskActions([A("2026-07-24", "PGR", "up", 210)], ageFrom("2026-07-27"), { windowDays: 4 });
  assert.equal(picked.length, 1, "Friday's upgrade must survive into Monday's brief");
});

test("nothing in the window yields an EMPTY section, never a stale backfill", () => {
  const picked = selectDeskActions(
    [A("2026-07-10", "OLD", "down", 50), A("2026-07-01", "OLDER", "up", 20)],
    ageFrom("2026-07-27"), { windowDays: 4 });
  assert.deepEqual(picked, [], "an honest blank beats presenting a 17-day-old downgrade as news");
});

test("ordering: newest first, and within one day the higher-signal action leads", () => {
  const all: DeskAction[] = [
    A("2026-07-25", "OLDUP", "up", 10),
    A("2026-07-27", "MAINT", "main", 20),
    A("2026-07-27", "UPGRD", "up", 30),
    A("2026-07-27", "INIT", "init", 40),
  ];
  const picked = selectDeskActions(all, ageFrom("2026-07-27"), { windowDays: 4 });
  assert.deepEqual(picked.map((a) => a.symbol), ["UPGRD", "INIT", "MAINT", "OLDUP"]);
});

test("signalTier and actionVerb cover every value Yahoo emits", () => {
  assert.deepEqual(["up", "down", "init", "reit", "main"].map((action) => signalTier({ action })), [0, 0, 1, 2, 2]);
  const g = { fromGrade: "Hold", toGrade: "Buy" };
  assert.match(actionVerb({ ...g, action: "up" }), /UPGRADE Hold→Buy/);
  assert.match(actionVerb({ ...g, action: "down" }), /DOWNGRADE Hold→Buy/);
  assert.match(actionVerb({ ...g, action: "init" }), /INITIATED at Buy/);
  assert.match(actionVerb({ ...g, action: "reit" }), /REITERATED Buy/);
  assert.match(actionVerb({ ...g, action: "main" }), /MAINTAINED Buy/);
  // An unknown future action value must not crash or render blank.
  assert.match(actionVerb({ ...g, action: "weird" }), /MAINTAINED Buy/);
});

test("a missing/unparseable date is treated as ancient, never as today", () => {
  const age = (iso: string) => (iso ? ageFrom("2026-07-27")(iso) : 9999);
  const picked = selectDeskActions([{ ...A("", "NODATE", "up", 10) }], age, { windowDays: 4 });
  assert.deepEqual(picked, [], "an undated action must not be smuggled in as current");
});
