import { test } from "node:test";
import assert from "node:assert/strict";
import { encodeBook, decodeBook } from "../lib/shareBook";

test("shareBook: round-trips positions + equity, URL-safe", () => {
  const text = "AAPL 100\nTSLA -50\nBRK-B 10";
  const enc = encodeBook(text, "250000");
  assert.ok(!/[+/=]/.test(enc), "URL-safe (no +, /, =)");
  assert.deepEqual(decodeBook(enc), { text, aum: "250000" });
  assert.deepEqual(decodeBook(encodeBook("", "")), { text: "", aum: "" });
});

test("shareBook: garbage decodes to null", () => {
  assert.equal(decodeBook("not-valid-base64!!"), null);
  assert.equal(decodeBook(btoa("[1,2,3]")), null); // valid b64 but wrong shape
});
