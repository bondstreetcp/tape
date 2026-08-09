import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldStandDown } from "../lib/companyArchive";

// The company-cache standdown: the good-IP pipe (the PC) owns the feed; everyone else yields to a
// FRESH foreign stamp and bakes as the fallback otherwise. Fail-open in every ambiguous case — a
// wrong "skip" starves the cache, a wrong "bake" only costs degraded fetches the carry-forward
// already survives.

const NOW = Date.parse("2026-08-10T06:00:00Z");
const M = (hoursAgo: number, writer: string) => ({ bakedAt: new Date(NOW - hoursAgo * 3_600_000).toISOString(), writer, bytes: 1 });

test("NAS yields to a fresh pc stamp; bakes when it ages out", () => {
  assert.equal(shouldStandDown(M(3, "pc"), "nas", NOW).skip, true);
  assert.equal(shouldStandDown(M(25, "pc"), "nas", NOW).skip, false, "stale stamp → fallback bake");
});

test("a writer never yields to its own stamp (the PC re-bakes nightly)", () => {
  assert.equal(shouldStandDown(M(2, "pc"), "pc", NOW).skip, false);
  assert.equal(shouldStandDown(M(2, "nas"), "nas", NOW).skip, false);
});

test("fail-open: missing, unparseable, or future-dated stamps all bake", () => {
  assert.equal(shouldStandDown(null, "nas", NOW).skip, false);
  assert.equal(shouldStandDown({ bakedAt: "garbage", writer: "pc", bytes: 1 }, "nas", NOW).skip, false);
  assert.equal(shouldStandDown(M(-2, "pc"), "nas", NOW).skip, false, "a stamp from the future is corrupt — bake");
});

test("GH yields to pc too (any fresh FOREIGN stamp)", () => {
  assert.equal(shouldStandDown(M(1, "pc"), "github", NOW).skip, true);
  assert.equal(shouldStandDown(M(1, "nas"), "github", NOW).skip, true, "nas fallback bake also covers GH");
});
