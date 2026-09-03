import { test } from "node:test";
import assert from "node:assert/strict";
import { deskBriefHasContent } from "../lib/deskNote";

// Regression guard for the Sep-3 shell trap: the PRO model returned a structurally-valid brief whose
// tldr + every bullet were just "..." placeholders, the old `sections.length>0` guard passed it, and the
// all-ellipses note shipped to production. These tests pin the content guard so it can't silently weaken.
// (The generic `isPlaceholderText` primitive is tested in tests/llmValidate.test.ts.)

// A real bullet has a non-placeholder fact; `read`/`tickers` are irrelevant to the guard.
const bullet = (fact: string) => ({ fact, read: "why it matters", tickers: [] });
const realNote = {
  tldr: "Risk-off tape on higher yields; DELL's drop pre-dated its blowout AMC print.",
  sections: [
    { heading: "Movers", synthesis: "s", bullets: [bullet("DELL −6.8% into the close"), bullet("NVDA +2.1%")] },
    { heading: "Filings that matter", synthesis: "s", bullets: [bullet("XYZ 8-K: CEO transition")] },
  ],
};

test("deskBriefHasContent accepts a real brief", () => {
  assert.equal(deskBriefHasContent(realNote), true);
});

test("deskBriefHasContent rejects the all-ellipses shell (the Sep-3 bug)", () => {
  const shell = {
    tldr: "...",
    sections: [
      { heading: "Movers", synthesis: "...", bullets: [bullet("..."), bullet("…"), bullet("—")] },
      { heading: "Filings that matter", synthesis: "...", bullets: [bullet("...")] },
    ],
  };
  assert.equal(deskBriefHasContent(shell), false, "structurally valid but content-empty must fail");
});

test("deskBriefHasContent rejects null/empty/missing structure", () => {
  assert.equal(deskBriefHasContent(null), false);
  assert.equal(deskBriefHasContent(undefined), false);
  assert.equal(deskBriefHasContent({}), false);
  assert.equal(deskBriefHasContent({ tldr: "real tldr here", sections: [] }), false, "no sections → shell");
});

test("deskBriefHasContent gates on BOTH the tldr and ≥3 real bullet facts", () => {
  // real tldr, but only 2 real bullets (the third is an ellipsis) → below the floor
  const twoReal = {
    tldr: "A perfectly real overview line.",
    sections: [{ heading: "Movers", synthesis: "s", bullets: [bullet("DELL −6.8%"), bullet("NVDA +2%"), bullet("…")] }],
  };
  assert.equal(deskBriefHasContent(twoReal), false, "2 real bullets is under the 3-bullet floor");

  // 3 real bullets but a placeholder tldr → tldr gate fails
  const noTldr = { ...realNote, tldr: "…" };
  assert.equal(deskBriefHasContent({ ...noTldr, sections: realNote.sections.concat({ heading: "x", synthesis: "s", bullets: [bullet("third real one")] }) }), false, "placeholder tldr fails even with 3 real bullets");

  // exactly 3 real bullets + real tldr → passes (boundary)
  const threeReal = {
    tldr: "Real overview.",
    sections: [{ heading: "Movers", synthesis: "s", bullets: [bullet("one"), bullet("two"), bullet("three")] }],
  };
  assert.equal(deskBriefHasContent(threeReal), true, "3 real bullets clears the floor");
});

test("deskBriefHasContent honors a custom minBullets (reuse by feeds with a lower floor)", () => {
  const oneBullet = { tldr: "Real overview.", sections: [{ heading: "x", synthesis: "s", bullets: [bullet("only one")] }] };
  assert.equal(deskBriefHasContent(oneBullet), false, "default floor is 3");
  assert.equal(deskBriefHasContent(oneBullet, 1), true, "minBullets=1 accepts a single real bullet");
});

test("deskBriefHasContent tolerates malformed sections/bullets without throwing", () => {
  const messy = {
    tldr: "Real overview line.",
    sections: [
      { heading: "a", synthesis: "s", bullets: undefined as unknown as { fact?: unknown }[] },
      { heading: "b", synthesis: "s", bullets: [null, undefined, { fact: "real one" }, { fact: "real two" }, { fact: "real three" }] as unknown as { fact?: unknown }[] },
    ],
  };
  assert.equal(deskBriefHasContent(messy), true, "skips null bullets / missing arrays, counts the 3 real facts");
});
