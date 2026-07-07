import { test } from "node:test";
import assert from "node:assert/strict";
import { buildCatalystPath } from "../lib/catalystPath";

const NOW = Date.parse("2026-07-07T00:00:00Z");

test("buildCatalystPath: merges feeds, drops past/beyond-horizon, sorts soonest-first", () => {
  const path = buildCatalystPath({
    nowMs: NOW,
    horizonDays: 400,
    earnings: { date: "2026-07-24", implied: 6.2, estimate: false }, // 17d
    biotech: [
      { date: "2026-12-27", kind: "pdufa", label: "FDA decision (PDUFA)", detail: "relutrigine" }, // ~173d
      { date: "2025-01-01", kind: "biotech", label: "old readout" }, // past → drop
    ],
    lockup: { date: "2026-09-01", detail: "IPO 2026-03-05" }, // ~56d
    investorDays: [{ date: "2027-10-01", label: "Analyst day" }], // ~451d → drop (>400)
    exDiv: { date: "2026-08-14", amount: 0.24 }, // ~38d
  });
  assert.deepEqual(path.map((e) => e.kind), ["earnings", "ex-div", "lockup", "pdufa"]);
  assert.equal(path[0].daysTo, 17);
  assert.equal(path[0].detail, "options imply ±6.2%");
  assert.equal(path[1].detail, "$0.24/sh");
  assert.equal(path[3].kind, "pdufa");
});

test("buildCatalystPath: empty / missing feeds → empty, no throw", () => {
  assert.deepEqual(buildCatalystPath({ nowMs: NOW }), []);
  assert.deepEqual(buildCatalystPath({ nowMs: NOW, earnings: null, biotech: [], lockup: null }), []);
});

test("buildCatalystPath: dedupes a same-day same-kind collision", () => {
  const path = buildCatalystPath({
    nowMs: NOW,
    biotech: [
      { date: "2026-10-15", kind: "pdufa", label: "FDA decision" },
      { date: "2026-10-15", kind: "pdufa", label: "FDA decision (dup)" },
    ],
  });
  assert.equal(path.length, 1);
});
