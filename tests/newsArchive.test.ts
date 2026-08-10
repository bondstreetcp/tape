import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeHeadlines, headlineKey } from "../lib/newsArchive";

const NOW = "2026-08-10T18:00:00.000Z";

test("mergeHeadlines: appends unseen, newest-first, echo collapses to one", () => {
  const existing = [{ t: "2026-08-01T00:00:00Z", title: "Acme raises guidance", pub: "Business Wire" }];
  const next = mergeHeadlines(
    existing,
    [
      { title: "Acme Raises Guidance!", publisher: "Reuters", time: "2026-08-02T00:00:00Z" }, // echo — same key
      { title: "Acme announces buyback", publisher: "PR Newswire", time: "2026-08-09T00:00:00Z" },
    ],
    NOW,
  );
  assert.equal(next.length, 2);
  assert.equal(next[0].title, "Acme announces buyback"); // newest first
  assert.equal(headlineKey(next[0].title), headlineKey("Acme Announces Buyback"));
});

test("mergeHeadlines: no new rows returns the SAME array (dirty-tracking depends on identity)", () => {
  const existing = [{ t: "2026-08-01T00:00:00Z", title: "Acme raises guidance", pub: "BW" }];
  const next = mergeHeadlines(existing, [{ title: "ACME RAISES GUIDANCE", publisher: "X", time: null }], NOW);
  assert.equal(next, existing);
});

test("mergeHeadlines: missing time falls back to first-seen date, cap drops the oldest", () => {
  const existing = Array.from({ length: 3 }, (_, i) => ({ t: `2026-07-0${i + 1}T00:00:00Z`, title: `old ${i}`, pub: "BW" }));
  const next = mergeHeadlines(existing, [{ title: "fresh", publisher: "RTRS", time: null }], NOW, 3);
  assert.equal(next.length, 3);
  assert.equal(next[0].title, "fresh");
  assert.equal(next[0].t, "2026-08-10"); // first-seen calendar date, not an invented instant
  assert.ok(!next.some((h) => h.title === "old 0")); // oldest dropped
});
