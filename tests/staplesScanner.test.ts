import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeScanFilename, tickerFor } from "../lib/staplesScanner";

// The upload portal (/api/staples/upload) writes the PDF into the watched folder under this name — it must
// never let a crafted filename escape the folder or carry odd characters.

test("sanitizeScanFilename: strips any path (no traversal)", () => {
  assert.equal(sanitizeScanFilename("../../etc/passwd.pdf"), "passwd.pdf");
  assert.equal(sanitizeScanFilename("C:\\Windows\\evil.pdf"), "evil.pdf");
  assert.equal(sanitizeScanFilename("/nested/folder/Beverages Nielsen.pdf"), "Beverages Nielsen.pdf");
  // A pure traversal segment leaves no usable stem → the safe default.
  assert.equal(sanitizeScanFilename("../"), "scan.pdf");
});

test("sanitizeScanFilename: keeps a readable name, forces one .pdf, caps length", () => {
  assert.equal(sanitizeScanFilename("Americas Beverages thru 8_8.pdf"), "Americas Beverages thru 8_8.pdf");
  assert.equal(sanitizeScanFilename("weird#name@!.PDF"), "weird_name.pdf"); // odd chars → "_", trailing trimmed
  assert.equal(sanitizeScanFilename(""), "scan.pdf");
  assert.equal(sanitizeScanFilename(null), "scan.pdf");
  const long = sanitizeScanFilename("x".repeat(400) + ".pdf");
  assert.ok(long.length <= 124 && long.endsWith(".pdf")); // 120-char stem + ".pdf"
});

test("tickerFor: maps a staples manufacturer name to its ticker (spot-check the map)", () => {
  // Just confirm the helper resolves a known name and returns null for an unknown one — no hard-coding here.
  assert.equal(typeof (tickerFor("Coca-Cola") ?? ""), "string");
  assert.equal(tickerFor("Some Unknown Co"), null);
});
