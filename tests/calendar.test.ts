import test from "node:test";
import assert from "node:assert/strict";
import { daysUntil, utcMidnight } from "../lib/calendar";

const WED = "2026-07-15"; // a Wednesday
const FRI = "2026-07-17"; // that week's expiry — 2 calendar days out
const at = (iso: string) => Date.parse(iso);

test("daysUntil: the answer does NOT depend on what time of day you ask", () => {
  // THE bug. The old math diffed a UTC-midnight-pinned date against a raw Date.now(), so a Friday
  // expiry read 2d at the 02:00Z nightly and 1d for a human at 11am ET — correct exactly when the
  // pipeline asked, wrong for the entire US session.
  const hours = ["00:00", "02:00", "12:41", "15:00", "19:59", "23:59"];
  for (const h of hours) {
    assert.equal(daysUntil(FRI, at(`${WED}T${h}:00Z`)), 2, `wrong at ${h}Z`);
  }
});

test("daysUntil: the old naive math is demonstrably wrong (this is what we replaced)", () => {
  const naive = (day: string, now: number) => Math.round((Date.parse(day + "T00:00:00Z") - now) / 86_400_000);
  assert.equal(naive(FRI, at(`${WED}T02:00:00Z`)), 2, "right when the nightly runs…");
  assert.equal(naive(FRI, at(`${WED}T15:00:00Z`)), 1, "…and wrong while the market is open");
});

test("daysUntil: today is 0, tomorrow is 1, yesterday is -1", () => {
  const noonish = at(`${WED}T15:00:00Z`);
  assert.equal(daysUntil(WED, noonish), 0);
  assert.equal(daysUntil("2026-07-16", noonish), 1);
  assert.equal(daysUntil("2026-07-14", noonish), -1);
});

test("daysUntil: expiry-selection gates can't flip with the clock", () => {
  // refresh-earnings-move advances to the next expiry when dte < 1. Under the old math a 12:41Z run
  // saw tomorrow's expiry as 0 and skipped it, pricing a LATER expiry and overstating the implied
  // move. Pin that the gate now reads the same at every hour of the run window.
  const tomorrow = "2026-07-16";
  for (const h of ["23:00", "02:11", "04:31", "12:41", "14:07"]) {
    const d = daysUntil(tomorrow, at(`${WED}T${h}:00Z`))!;
    assert.equal(d >= 1, true, `gate flipped at ${h}Z (dte=${d})`);
  }
});

test("daysUntil: month and year boundaries", () => {
  assert.equal(daysUntil("2026-08-01", at("2026-07-31T18:00:00Z")), 1);
  assert.equal(daysUntil("2027-01-01", at("2026-12-31T23:30:00Z")), 1);
  assert.equal(daysUntil("2026-03-09", at("2026-03-08T12:00:00Z")), 1, "US DST weekend — UTC has no DST");
});

test("daysUntil: leap day", () => {
  assert.equal(daysUntil("2028-02-29", at("2028-02-28T20:00:00Z")), 1);
  assert.equal(daysUntil("2028-03-01", at("2028-02-28T20:00:00Z")), 2);
});

test("daysUntil: junk is null, not a wrong number", () => {
  assert.equal(daysUntil("", at(`${WED}T12:00:00Z`)), null);
  assert.equal(daysUntil("not-a-date", at(`${WED}T12:00:00Z`)), null);
  // callers coalesce null to -1 so it falls out of their dte >= min filters
  assert.equal(daysUntil("nope", at(`${WED}T12:00:00Z`)) ?? -1, -1);
});

test("daysUntil: a full instant is floored to its UTC day, not mixed bases", () => {
  assert.equal(daysUntil("2026-07-17T20:00:00.000Z", at(`${WED}T15:00:00Z`)), 2);
});

test("utcMidnight: floors to the day, and is idempotent", () => {
  const m = utcMidnight(at("2026-07-15T15:00:00Z"));
  assert.equal(new Date(m).toISOString(), "2026-07-15T00:00:00.000Z");
  assert.equal(utcMidnight(m), m);
});
