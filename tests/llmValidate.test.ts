import { test } from "node:test";
import assert from "node:assert/strict";
import { normText, groundedQuote, boundedNumber, numberGroundedIn, isoDateOnly, coerceEnum, cleanTicker, whitelistTickers, str } from "../lib/llmValidate";

test("numberGroundedIn: grounds numbers that appear (any common filing form), drops fabricated ones", () => {
  const eps = "GAAP and Adjusted EPS in the range of $7.50 to $8.50.";
  assert.equal(numberGroundedIn(7.5, eps), true); // $7.50 grounds 7.5 (trailing-zero form)
  assert.equal(numberGroundedIn(8.5, eps), true);
  assert.equal(numberGroundedIn(1.7, "Adjusted EPS of approximately $1.70"), true);
  const rev = "We expect revenue of $40.1 to $40.9 billion.";
  assert.equal(numberGroundedIn(40100, rev), true); // stored in $M, written in $B
  assert.equal(numberGroundedIn(40900, rev), true);
  // The LEN fabrication: revenue computed from 20,500-21,500 homes × price — never in the text.
  const homes = "we expect to deliver approximately 20,500 to 21,500 homes with gross margin near 16%.";
  assert.equal(numberGroundedIn(7687.5, homes), false); // computed $M — NOT grounded
  assert.equal(numberGroundedIn(21500, homes), true); // the unit count IS in the text
  // Boundaries + edge cases.
  assert.equal(numberGroundedIn(7.5, "the multiple is 17.55x"), false); // not a substring of a bigger number
  assert.equal(numberGroundedIn(0, "guidance of 0"), false); // 0 / non-finite never grounds
  assert.equal(numberGroundedIn(-0.5, "a loss of $(0.50) per share"), true); // sign-agnostic
});

test("normText: collapses whitespace, drops $ and commas, lowercases, trims", () => {
  assert.equal(normText("  Hello,  $1,234   WORLD "), "hello 1234 world");
  assert.equal(normText(undefined as unknown as string), "");
});

test("groundedQuote: returns the original when grounded, null when not", () => {
  const src = "The company raised FY26 guidance to $1,234M in revenue.";
  assert.equal(groundedQuote("raised FY26 guidance", src), "raised FY26 guidance"); // present
  assert.equal(groundedQuote("$1,234M in revenue", src), "$1,234M in revenue"); // $/comma/case-insensitive match
  assert.equal(groundedQuote("cut FY26 guidance", src), null); // paraphrase not in source
  assert.equal(groundedQuote("we EXPECT", src), null); // "we now expect" ≠ "we expect" — not a substring
});
test("groundedQuote: rejects too-short and non-string quotes", () => {
  assert.equal(groundedQuote("up", "the stock is up"), null); // below minLen
  assert.equal(groundedQuote(42, "the answer is 42"), null);
});

test("boundedNumber: enforces the band, coerces numeric strings", () => {
  assert.equal(boundedNumber(5, { min: 0, max: 10 }), 5);
  assert.equal(boundedNumber("1,234", { max: 2000 }), 1234); // strips comma
  assert.equal(boundedNumber("$5.50", {}), 5.5); // strips $
  assert.equal(boundedNumber(250, { absMax: 200 }), null); // |v| over cap
  assert.equal(boundedNumber(-250, { absMax: 200 }), null); // symmetric cap
  assert.equal(boundedNumber(-1, { min: 0 }), null);
  assert.equal(boundedNumber(11, { max: 10 }), null);
  assert.equal(boundedNumber("n/a", {}), null);
  assert.equal(boundedNumber(Infinity, {}), null);
  assert.equal(boundedNumber(null, {}), null);
  assert.equal(boundedNumber({}, {}), null);
});

test("isoDateOnly: accepts real ISO dates, rejects impossible ones", () => {
  assert.equal(isoDateOnly("2026-07-03"), "2026-07-03");
  assert.equal(isoDateOnly("2026-07-03T10:47:00Z"), "2026-07-03"); // slices to the day
  assert.equal(isoDateOnly("2026-13-45"), null); // month 13 / day 45 → NaN
  assert.equal(isoDateOnly("2026-00-10"), null); // month 00
  assert.equal(isoDateOnly("banana"), null);
  assert.equal(isoDateOnly(""), null);
  assert.equal(isoDateOnly(20260703), null); // non-string
});

test("coerceEnum: passes known values, falls back otherwise", () => {
  const kinds = ["rich", "cheap", "fair"] as const;
  assert.equal(coerceEnum("cheap", kinds, "fair"), "cheap");
  assert.equal(coerceEnum("very cheap", kinds, "fair"), "fair"); // embellished → fallback
  assert.equal(coerceEnum(null, kinds, "fair"), "fair");
});

test("cleanTicker: uppercases, scrubs the charset, caps length", () => {
  assert.equal(cleanTicker("aapl"), "AAPL");
  assert.equal(cleanTicker("brk.b"), "BRK.B"); // dot preserved
  assert.equal(cleanTicker("  msft "), "MSFT"); // spaces scrubbed
  assert.equal(cleanTicker("NVDA$$"), "NVDA");
  assert.equal(cleanTicker("TOOLONGTICKER"), "TOOLON"); // sliced to 6
  assert.equal(cleanTicker(null), "");
});

test("whitelistTickers: keeps only known symbols, dedups, preserves order", () => {
  const known = new Set(["AAPL", "MSFT", "NVDA"]);
  assert.deepEqual(whitelistTickers(["AAPL", "GOOG", "msft"], known), ["AAPL", "MSFT"]); // GOOG hallucinated → dropped
  assert.deepEqual(whitelistTickers(["AAPL", "aapl"], known), ["AAPL"]); // dedup after cleaning
  assert.deepEqual(whitelistTickers(["nvda"], ["AAPL", "NVDA"]), ["NVDA"]); // array known → uppercased
  assert.deepEqual(whitelistTickers("AAPL", known), []); // non-array → []
  assert.deepEqual(whitelistTickers(null, known), []);
});

test("str: trims strings, empties everything else (no throw)", () => {
  assert.equal(str("  hi "), "hi");
  assert.equal(str(5), "");
  assert.equal(str(null), "");
  assert.equal(str({}), "");
});
