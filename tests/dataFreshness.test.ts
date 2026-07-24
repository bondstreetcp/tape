import test from "node:test";
import assert from "node:assert/strict";
import { secDiagnosis, scheduleAllowanceHours, type FreshResult, type SecProbe } from "../lib/dataFreshness";

const feed = (file: string, status: FreshResult["status"], origin?: "sec"): FreshResult => ({
  file, label: file, tier: "core", status, ageHours: 99, maxAgeHours: 30, count: 0, minCount: null,
  detail: "x", ...(origin ? { origin } : {}),
});
const up: SecProbe = { reachable: true, status: 200, ms: 312, detail: "data.sec.gov responded 200 in 312ms" };
const down: SecProbe = { reachable: false, status: null, ms: 8001, detail: "data.sec.gov unreachable — timed out (>8s)" };

test("secDiagnosis: SEC feeds failing + SEC UP ⇒ point at feed logic, not the network", () => {
  const results = [feed("buybacks.json", "empty", "sec"), feed("insiders.json", "stale", "sec")];
  const v = secDiagnosis(results, up);
  assert.match(v, /2 SEC-sourced feed\(s\) failing \(buybacks, insiders\)/);
  assert.match(v, /SEC is UP/);
  assert.match(v, /FEED LOGIC/);
  assert.doesNotMatch(v, /ENVIRONMENTAL/);
});

test("secDiagnosis: SEC feeds failing + SEC DOWN ⇒ environmental (the NAS case)", () => {
  const results = [feed("buybacks.json", "empty", "sec"), feed("insiders.json", "stale", "sec"), feed("valuation-history.json", "stale", "sec")];
  const v = secDiagnosis(results, down);
  assert.match(v, /3 SEC-sourced feed\(s\) failing/);
  assert.match(v, /ENVIRONMENTAL/);
  assert.match(v, /can't reach SEC/);
  assert.doesNotMatch(v, /FEED LOGIC/);
});

test("secDiagnosis: no SEC feed failing ⇒ empty string (nothing to diagnose)", () => {
  // macro/FRED is not origin:sec, so a FRED failure must NOT trigger an SEC verdict.
  assert.equal(secDiagnosis([feed("macro.json", "stale")], down), "");
  // a healthy SEC feed doesn't trigger it either
  assert.equal(secDiagnosis([feed("buybacks.json", "ok", "sec")], up), "");
  assert.equal(secDiagnosis([], up), "");
});

test("secDiagnosis: a non-SEC failure alongside a healthy SEC feed stays quiet", () => {
  const results = [feed("macro.json", "stale"), feed("buybacks.json", "ok", "sec")];
  assert.equal(secDiagnosis(results, up), "");
});

test("secDiagnosis: SEC failing but probe skipped (null) ⇒ says it wasn't probed", () => {
  const v = secDiagnosis([feed("buybacks.json", "empty", "sec")], null);
  assert.match(v, /not probed/);
  assert.doesNotMatch(v, /ENVIRONMENTAL|FEED LOGIC/);
});

test("secDiagnosis: only the FAILING sec feeds are named, healthy ones excluded", () => {
  const results = [feed("buybacks.json", "empty", "sec"), feed("corp-events.json", "ok", "sec"), feed("insiders.json", "missing", "sec")];
  const v = secDiagnosis(results, down);
  assert.match(v, /\(buybacks, insiders\)/);
  assert.doesNotMatch(v, /corp-events/);
});

// ── scheduleAllowanceHours: the weekend-503-by-design fix (2026-07-24) ────────────────────────────
// FULL runs exist only Mon-Fri ~22:47 UTC; fixed thresholds made /api/health/data go red EVERY
// Sun/Mon, which blocked wiring any served-side uptime monitor. Worked instants, exact by hand.
const close = (a: number, b: number) => assert.ok(Math.abs(a - b) < 0.02, `${a} !~ ${b}`);

test("weekday: allowance stays under the CORE threshold (no weakening)", () => {
  // Tue 2026-07-21 10:00Z — last slot Mon 20th 22:47Z → 11.22h + 8h slack
  close(scheduleAllowanceHours(Date.parse("2026-07-21T10:00:00Z")), 11.2167 + 8);
});

test("Sunday: allowance spans back to Friday's slot", () => {
  // Sun 2026-07-19 12:00Z — last slot Fri 17th 22:47Z → 37.2167h + 8
  close(scheduleAllowanceHours(Date.parse("2026-07-19T12:00:00Z")), 37.2167 + 8);
});

test("Monday pre-FULL: the whole weekend gap is allowed; post-FULL it resets", () => {
  // Mon 2026-07-20 12:00Z — still Friday's slot → 61.2167h + 8
  close(scheduleAllowanceHours(Date.parse("2026-07-20T12:00:00Z")), 61.2167 + 8);
  // Mon 2026-07-20 23:00Z — Monday's own 22:47 slot has passed → 0.2167h + 8
  close(scheduleAllowanceHours(Date.parse("2026-07-20T23:00:00Z")), 0.2167 + 8);
});

test("Saturday early: Friday's slot, small allowance", () => {
  close(scheduleAllowanceHours(Date.parse("2026-07-18T02:00:00Z")), 3.2167 + 8);
});
