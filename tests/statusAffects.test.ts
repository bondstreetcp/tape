import { test } from "node:test";
import assert from "node:assert/strict";
import { FEEDS_FOR_TEST } from "../lib/dataFreshness";
import { ALL_NAV } from "../lib/nav";

// The /status page turns "estimates.json is EMPTY" into "Revisions, Analyst Upside and Short-Squeeze
// are degraded". That mapping is only trustworthy if it can't rot: a renamed or retired route would
// otherwise leave the status page quietly naming a board that no longer exists, or (worse) failing to
// name one that does. The UI drops unresolvable paths silently, so without this test the rot would be
// invisible — exactly the failure mode this whole page was built to end.

const NAV_PATHS = new Set(ALL_NAV.map((n) => n.path));

test("every `affects` path resolves to a real nav route", () => {
  const bad: string[] = [];
  for (const f of FEEDS_FOR_TEST) {
    for (const p of f.affects ?? []) if (!NAV_PATHS.has(p)) bad.push(`${f.file} → ${p}`);
  }
  assert.deepEqual(bad, [], `feeds pointing at non-existent nav paths (rename or retire them): ${bad.join(", ")}`);
});

test("`affects` entries are unique per feed (a duplicate would double-count the impact)", () => {
  const dupes: string[] = [];
  for (const f of FEEDS_FOR_TEST) {
    const seen = new Set<string>();
    for (const p of f.affects ?? []) {
      if (seen.has(p)) dupes.push(`${f.file} → ${p}`);
      seen.add(p);
    }
  }
  assert.deepEqual(dupes, []);
});

test("the registry is non-trivial and the /status route itself is registered in nav", () => {
  assert.ok(FEEDS_FOR_TEST.length > 40, "the feed registry should cover the site's feeds");
  assert.ok(NAV_PATHS.has("/status"), "/status must be reachable from the nav, or nobody finds it");
});
