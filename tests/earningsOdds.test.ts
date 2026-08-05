import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEarningsSlug, driftEps, pBeatFrom, SPREAD_SUPPRESS } from "../lib/earningsOdds";

// Slug shapes verified against the live venue 2026-08-05 (gamma-api /events?tag_slug=earnings):
//   etsy-quarterly-earnings-gaap-eps-07-29-2026-0pt72      → ETSY  gaap    2026-07-29  0.72
//   tday-quarterly-earnings-gaap-eps-07-30-2026-neg0pt02   → TDAY  gaap    2026-07-30  -0.02
//   tfx-quarterly-earnings-nongaap-eps-07-30-2026-1pt27    → TFX   nongaap 2026-07-30  1.27
// The parser must refuse anything else — an unparseable slug is a skipped market, never a guessed one.

test("parses the three observed slug shapes exactly", () => {
  assert.deepEqual(parseEarningsSlug("etsy-quarterly-earnings-gaap-eps-07-29-2026-0pt72"), {
    ticker: "ETSY", basis: "gaap", reportDate: "2026-07-29", strikeEps: 0.72,
  });
  assert.deepEqual(parseEarningsSlug("tday-quarterly-earnings-gaap-eps-07-30-2026-neg0pt02"), {
    ticker: "TDAY", basis: "gaap", reportDate: "2026-07-30", strikeEps: -0.02,
  });
  assert.deepEqual(parseEarningsSlug("tfx-quarterly-earnings-nongaap-eps-07-30-2026-1pt27"), {
    ticker: "TFX", basis: "nongaap", reportDate: "2026-07-30", strikeEps: 1.27,
  });
});

test("integer strikes, class-share tickers, and zero bars", () => {
  assert.equal(parseEarningsSlug("nvda-quarterly-earnings-nongaap-eps-08-27-2026-2")?.strikeEps, 2);
  // Internal hyphens survive uppercased — this repo spells class shares the Yahoo way (BRK-B).
  assert.equal(parseEarningsSlug("brk-b-quarterly-earnings-gaap-eps-11-07-2026-4pt5")?.ticker, "BRK-B");
  // A literal zero bar (observed live: chym-…-0) parses to 0, not null.
  assert.equal(parseEarningsSlug("chym-quarterly-earnings-gaap-eps-08-05-2026-0")?.strikeEps, 0);
});

test("the reportDate is a bare calendar square (never shifted through a timezone)", () => {
  // The date-bug class this repo has hit 3×: MM-DD-YYYY from the slug must survive verbatim as
  // YYYY-MM-DD. Any Date()-roundtrip would shift it across midnight in some timezone.
  const p = parseEarningsSlug("oxy-quarterly-earnings-nongaap-eps-08-05-2026-1pt88");
  assert.equal(p?.reportDate, "2026-08-05");
});

test("junk slugs are refused", () => {
  for (const s of [
    "xi-jinping-out-before-2027",
    "etsy-quarterly-earnings-eps-07-29-2026-0pt72", // basis missing
    "etsy-quarterly-earnings-gaap-eps-2026-07-29-0pt72", // date order wrong
    "etsy-quarterly-earnings-gaap-eps-07-29-2026-", // strike missing
    "",
  ])
    assert.equal(parseEarningsSlug(s), null, `must refuse: ${s}`);
});

test("drift exists only where the comparison is honest (non-GAAP bar vs street consensus)", () => {
  assert.equal(driftEps("nongaap", 1.27, 1.4), 0.13);
  assert.equal(driftEps("nongaap", -0.02, -0.05), -0.03);
  // GAAP bar vs an adjusted consensus is apples-to-oranges — no number is better than a fake one.
  assert.equal(driftEps("gaap", 1.27, 1.4), null);
  assert.equal(driftEps("nongaap", 1.27, null), null);
});

test("P(beat) prefers the two-sided mid, falls back to the venue mark, clamps to [0,1]", () => {
  assert.equal(pBeatFrom(0.85, 0.95, 0.66), 0.9); // mid wins over a stale last-trade mark
  assert.equal(pBeatFrom(null, 0.95, 0.66), 0.66); // one-sided book → the mark
  assert.equal(pBeatFrom(null, null, null), null);
  assert.equal(pBeatFrom(0.99, 1.5, null), null); // ask>1 = junk quote → falls to the mark, which is absent
  assert.equal(pBeatFrom(0.99, 1.5, 0.97), 0.97); // …and to the mark when present
});

test("the suppress threshold is 10c — the audit's number, pinned", () => {
  assert.equal(SPREAD_SUPPRESS, 0.10);
});
