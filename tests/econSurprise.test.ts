import { test } from "node:test";
import assert from "node:assert/strict";
import { surpriseIdOf, standardizeSurprise, metricConsistent, type SurpriseEvent } from "../lib/econSurprise";
import { matchEstimate } from "../lib/econEstimates";

// The surprise tracker (scripts/refresh-econ-surprise.ts) records a standardized beat/miss for each new
// macro print. These pin the pieces that a 2026-09-08 review flagged ("did it catch Friday's jobs report?").

test("surpriseIdOf: stable identity, backward-compatible with pre-`obs` events", () => {
  const withObs: SurpriseEvent = { key: "cpi", label: "CPI", category: "Inflation", date: "2026-09-11", actual: 3.4, consensus: 3.3, unit: "%", z: 0.5, obs: "2026-08-01" };
  const legacy: SurpriseEvent = { key: "cpi", label: "CPI", category: "Inflation", date: "2026-08-01", actual: 3.4, consensus: 3.3, unit: "%", z: 0.5 };
  // A monthly print's identity is its reference month, regardless of the (later) release date it now stores.
  assert.equal(surpriseIdOf(withObs), "cpi|2026-08-01");
  // Legacy rows (date == reference month, no obs) resolve to the SAME id, so the schema bump doesn't re-add them.
  assert.equal(surpriseIdOf(legacy), "cpi|2026-08-01");
});

test("standardizeSurprise: scale, sign, invert and clamp", () => {
  // payrolls scale 70K: +140K over consensus → +2σ.
  assert.equal(standardizeSurprise("payrolls", 200, 60), 2);
  // claims is inverted (more claims = weaker): a higher-than-expected print is a NEGATIVE surprise.
  assert.ok((standardizeSurprise("claims", 230, 200) ?? 0) < 0);
  // clamped to ±3σ.
  assert.equal(standardizeSurprise("cpi", 5, 0), 3);
  assert.equal(standardizeSurprise("cpi", -5, 0), -3);
  assert.equal(standardizeSurprise("unknown-key", 1, 0), null);
});

test("consensus match: run-date matches a monthly release; the reference month does not", () => {
  // A monthly CPI release: FRED's reference month is 2026-08-01, but the print (and its ForexFactory
  // consensus) land ~2026-09-11 — five weeks later.
  const ff = [
    { title: "CPI m/m", country: "USD", date: "2026-09-11T12:30:00Z", impact: "High", forecast: "0.3%", previous: "0.2%" },
  ];
  // The OLD behaviour keyed the match off the reference month → outside the ±7d window → missed (the bug).
  assert.equal(matchEstimate("cpi", "2026-08-01", ff), null);
  // The FIX matches against the run date (the print is landing now) → the consensus is found.
  const hit = matchEstimate("cpi", "2026-09-10", ff);
  assert.equal(hit?.forecast, "0.3%");
});

test("metricConsistent: reject a YoY release scored against an m/m consensus", () => {
  // PPI's transform is YoY; when ForexFactory only carries "PPI m/m", the units don't line up — skip it
  // rather than write a garbage z (a YoY ~4.7% vs an m/m 0.4% forecast clamps to a bogus +3σ).
  assert.equal(metricConsistent("yoy", "PPI m/m"), false);
  assert.equal(metricConsistent("yoy", "PPI y/y"), true);
  assert.equal(metricConsistent("mom", "Retail Sales m/m"), true);
  assert.equal(metricConsistent("momChange", "Non-Farm Employment Change"), true); // names neither → ok
  assert.equal(metricConsistent("level", "UoM Consumer Sentiment"), true); // level release → ok
});
