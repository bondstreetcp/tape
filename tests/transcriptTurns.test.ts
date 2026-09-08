import { test } from "node:test";
import assert from "node:assert/strict";
import { classifySpeaker, splitNameRole, parseTranscriptTurns, splitIntoBubbles, callExcerpt } from "../lib/transcriptTurns";

// The reader UI (components/TranscriptReader) renders these turns as an iMessage thread: management right,
// analysts/operator left. These pin the speaker classification + the labeled-text split.

test("classifySpeaker: operator / management / analyst", () => {
  assert.equal(classifySpeaker("Operator"), "operator");
  assert.equal(classifySpeaker("Calvin McDonaldChief Executive Officer at Lululemon"), "mgmt");
  assert.equal(classifySpeaker("Howard TubinVP of Investor Relations"), "mgmt");
  assert.equal(classifySpeaker("Meghan Frank - Chief Financial Officer"), "mgmt");
  assert.equal(classifySpeaker("Matthew Boss - JPMorgan"), "analyst");
  assert.equal(classifySpeaker("Lorraine Hutchinson, Bank of America"), "analyst");
  assert.equal(classifySpeaker("Jane Doe"), "mgmt"); // unknown → leans management (prepared remarks)
});

test("splitNameRole: separate a glued name+role", () => {
  assert.deepEqual(splitNameRole("Howard TubinVP of Investor Relations at Lululemon Athletica"), {
    name: "Howard Tubin",
    role: "VP of Investor Relations at Lululemon Athletica",
  });
  assert.deepEqual(splitNameRole("Calvin McDonald"), { name: "Calvin McDonald", role: "" });
  assert.deepEqual(splitNameRole("Operator"), { name: "Operator", role: "" });
  // "COO" must not match the "coo" inside "Cook" — the name is "Tim Cook", not "Tim"
  assert.deepEqual(splitNameRole("Tim CookCEO at Apple"), { name: "Tim Cook", role: "CEO at Apple" });
  // MarketBeat glues analyst labels too — "Amit DaryananiAnalyst at Evercore"
  assert.deepEqual(splitNameRole("Amit DaryananiAnalyst at Evercore"), { name: "Amit Daryanani", role: "Analyst at Evercore" });
});

test("splitIntoBubbles: walls of text become several short bubbles; short stays one", () => {
  assert.deepEqual(splitIntoBubbles("Short and sweet."), ["Short and sweet."]);
  // explicit paragraphs → one bubble each
  assert.deepEqual(splitIntoBubbles("First para.\n\nSecond para."), ["First para.", "Second para."]);
  // a long single paragraph → split into <=maxChars sentence groups, none mid-sentence
  const wall = "We delivered a strong quarter with broad-based growth. Revenue rose sharply across every region. Margins expanded on better mix. Guidance was raised for the year ahead.";
  const bubbles = splitIntoBubbles(wall, 80);
  assert.ok(bubbles.length >= 2, "the wall is broken up");
  assert.ok(bubbles.every((b) => b.length <= 100), "each bubble is reader-sized");
  assert.equal(bubbles.join(" ").replace(/\s+/g, " "), wall.replace(/\s+/g, " "), "no text lost");
  assert.deepEqual(splitIntoBubbles(""), []);
});

test("callExcerpt: prefers the exec's opening over the IR safe-harbour boilerplate, capped", () => {
  const text = [
    "Jane Doe - Director of Investor Relations: Welcome to the call. Some of the statements we make today are forward-looking statements, and please refer to the risk factors discussed in our SEC filings for more detail.",
    "John Smith - Chief Executive Officer: Good afternoon, everyone, and thanks for joining. We delivered record revenue of $5 billion this quarter, up 20 percent, and we are raising our full-year guidance on broad-based demand.",
  ].join("\n\n");
  const ex = callExcerpt(text, 120);
  assert.ok(ex.startsWith("Good afternoon, everyone"), `picks the CEO, got: ${ex}`);
  assert.ok(!/forward-looking/.test(ex), "skips the IR safe-harbour turn");
  assert.ok(ex.length <= 122, "capped to ~max on a word boundary");
  assert.equal(callExcerpt(""), ""); // no turns → empty
});

test("parseTranscriptTurns: splits labeled turns, classifies sides, merges continuations", () => {
  const text = [
    "Operator: Welcome to the call.",
    "Calvin McDonaldChief Executive Officer: We had a strong quarter.\n\nGrowth was broad-based.",
    "Matthew Boss - JPMorgan: How should we think about margins?",
    "Meghan Frank - CFO: Gross margin expanded 80 basis points.",
  ].join("\n\n");
  const turns = parseTranscriptTurns(text);
  assert.equal(turns.length, 4);
  assert.equal(turns[0].side, "operator");
  assert.equal(turns[1].side, "mgmt");
  assert.equal(turns[1].speaker, "Calvin McDonald");
  assert.ok(turns[1].text.includes("Growth was broad-based"), "continuation merged into the prior turn");
  assert.equal(turns[2].side, "analyst");
  assert.equal(turns[3].side, "mgmt");
});
