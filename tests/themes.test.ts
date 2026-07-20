import { test } from "node:test";
import assert from "node:assert/strict";
import { parseTags, themeExposure } from "../lib/themes";

test("parseTags: multi-theme, separators, share-class normalize", () => {
  const t = parseTags("NVDA AI\nNVDA Semis\nAMD, AI\nXOM: Energy\nBRK.B Financials\n# comment\ngarbage-line-no-theme");
  assert.deepEqual(t.get("NVDA"), ["AI", "Semis"]);
  assert.deepEqual(t.get("AMD"), ["AI"]);
  assert.deepEqual(t.get("XOM"), ["Energy"]);
  assert.deepEqual(t.get("BRK-B"), ["Financials"]); // BRK.B → BRK-B
});

test("themeExposure: overlapping themes, coverage", () => {
  const holdings = [
    { symbol: "NVDA", value: 30000 }, // AI + Semis
    { symbol: "AMD", value: 10000 }, // AI
    { symbol: "XOM", value: -8000 }, // Energy (short)
    { symbol: "UNTAGGED", value: 12000 }, // no theme
  ];
  const tags = parseTags("NVDA AI\nNVDA Semis\nAMD AI\nXOM Energy");
  const { rows, coverage } = themeExposure(holdings, tags);
  const byT = Object.fromEntries(rows.map((r) => [r.theme, r]));
  assert.equal(byT["AI"].gross, 40000); // NVDA 30k + AMD 10k
  assert.equal(byT["AI"].names, 2);
  assert.equal(byT["Semis"].gross, 30000); // NVDA only (overlaps with AI by design)
  assert.equal(byT["Energy"].net, -8000); // XOM short
  assert.equal(rows[0].theme, "AI"); // sorted by gross desc
  // coverage: tagged gross 48k of total 60k (UNTAGGED excluded), each name counted once
  assert.ok(Math.abs(coverage - 48000 / 60000) < 1e-9);
});
