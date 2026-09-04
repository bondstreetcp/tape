import { test } from "node:test";
import assert from "node:assert/strict";
import { narrative, narrativeList, isPlaceholderText } from "../lib/llmValidate";

// narrative()/narrativeList() are the single write-boundary guard for LLM-authored prose across the nightly
// feeds. The failure they close: `String(out.summary || "").slice(0, n)` stored the model's content-empty
// "…" shell because the string was truthy (the Sep-3 all-ellipses desk note, then 13F-story and congress).

test("narrative: real text is trimmed and capped; placeholders and non-strings become ''", () => {
  assert.equal(narrative("  Comparable sales accelerated to +14%.  ", 400), "Comparable sales accelerated to +14%.");
  assert.equal(narrative("abcdefghij", 5), "abcde");
  for (const shell of ["…", "...", "— — —", "-", "", "  .  ", undefined, null, 42, { text: "x" }]) {
    assert.equal(narrative(shell as unknown, 100), "", `expected '' for ${JSON.stringify(shell)}`);
  }
  // Short-but-real strings survive (a ticker, a firm) — the placeholder test is about content, not length.
  assert.equal(narrative("UBS", 40), "UBS");
  assert.equal(isPlaceholderText("UBS"), false);
});

test("narrativeList: drops shells and non-strings, caps each item and the count", () => {
  const out = narrativeList(["first point", "…", 7, "  second point  ", "...", "third", "fourth"], 3, 8);
  assert.deepEqual(out, ["first po", "second p", "third"]);
  assert.deepEqual(narrativeList("not an array", 3), []);
  assert.deepEqual(narrativeList(["…", "—"], 3), []); // an all-shell list is an empty list
});
