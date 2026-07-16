import test from "node:test";
import assert from "node:assert/strict";
import { secDiagnosis, type FreshResult, type SecProbe } from "../lib/dataFreshness";

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
