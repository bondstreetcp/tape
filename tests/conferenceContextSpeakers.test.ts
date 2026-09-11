import { test } from "node:test";
import assert from "node:assert/strict";
import { renderContextTurns } from "../scripts/conference-context-speakers";
import { parseTranscriptTurns } from "../lib/transcriptTurns";
test("context boundaries preserve words and separate moderator from management", () => {
  const lines = ["Welcome. How is demand?", "Demand is improving.", "We remain cautious."];
  const turns = parseTranscriptTurns(renderContextTurns(lines, [{ line: 0, role: "moderator" }, { line: 1, role: "management" }]));
  assert.deepEqual(turns.map(t => t.side), ["analyst", "mgmt"]);
  assert.equal(turns.map(t => t.text).join(" ").replace(/\s+/g, " "), lines.join(" "));
  assert.match(turns[0].role, /inferred from transcript/);
});
test("rejects missing, unordered and out-of-range boundaries", () => {
  for (const boundaries of [[{line: 1, role: "management" as const}], [{line: 0, role: "moderator" as const}, {line: 0, role: "management" as const}], [{line: 0, role: "moderator" as const}, {line: 9, role: "management" as const}]]) {
    assert.throws(() => renderContextTurns(["one", "two"], boundaries));
  }
});
