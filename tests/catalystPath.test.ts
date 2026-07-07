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

test("buildCatalystPath: mid-session NOW keeps today's catalyst at daysTo=0 (no off-by-one drop)", () => {
  // The API route passes Date.now(); at 15:00 UTC (mid US session) an event dated today must be
  // daysTo=0, not -1 (which `daysTo < 0` would drop). Regression for the floor-to-UTC-midnight fix.
  const midSession = Date.parse("2026-07-07T15:00:00Z");
  const path = buildCatalystPath({
    nowMs: midSession,
    earnings: { date: "2026-07-07", implied: 5, estimate: false }, // today
    biotech: [{ date: "2026-07-08", kind: "pdufa", label: "FDA decision (PDUFA)" }], // +1d
    exDiv: { date: "2026-07-10", amount: 0.5 }, // +3d
  });
  const earn = path.find((e) => e.kind === "earnings");
  assert.ok(earn, "today's earnings must not be dropped during market hours");
  assert.equal(earn!.daysTo, 0);
  assert.equal(path.find((e) => e.kind === "pdufa")!.daysTo, 1);
  assert.equal(path.find((e) => e.kind === "ex-div")!.daysTo, 3);
});
