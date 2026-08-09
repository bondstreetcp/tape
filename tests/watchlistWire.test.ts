import { test } from "node:test";
import assert from "node:assert/strict";
import { orderWire, normalizeSyms, type WireName } from "../lib/watchlistWire";

// The wire's reading order IS the product: fresh prints first, then the tape's own priority
// (|1d move|), then names with something to read — so the morning scan starts where action is.

const N = (symbol: string, over: Partial<WireName> = {}): WireName => ({
  symbol, name: null, pct1d: null, reported: null, catalyst: null, headlines: [], ...over,
});

test("orderWire: reported names lead (freshest print first), then |move|, then headlines, then alpha", () => {
  const rows = [
    N("QUIET"),
    N("MOVER", { pct1d: -6.2 }),
    N("NEWSY", { headlines: [{ title: "t", date: "2026-08-08", publisher: "p", link: null }] }),
    N("REPTODAY", { reported: { date: "2026-08-08", daysAgo: 0 }, pct1d: 1.1 }),
    N("REPOLD", { reported: { date: "2026-08-05", daysAgo: 3 }, pct1d: 9.9 }),
    N("AAA"),
  ];
  const out = orderWire(rows).map((r) => r.symbol);
  // Today's print outranks a bigger mover that reported 3d ago; movers outrank newsy; alpha last.
  assert.deepEqual(out, ["REPTODAY", "REPOLD", "MOVER", "NEWSY", "AAA", "QUIET"]);
});

test("orderWire is non-mutating and stable for equals", () => {
  const rows = [N("B"), N("A")];
  const out = orderWire(rows);
  assert.deepEqual(rows.map((r) => r.symbol), ["B", "A"], "input untouched");
  assert.deepEqual(out.map((r) => r.symbol), ["A", "B"]);
});

test("normalizeSyms: uppercase, dedupe, junk dropped, capped", () => {
  assert.deepEqual(normalizeSyms(" eat, EAT , armk,BRK.B,bad$sym,"), ["EAT", "ARMK", "BRK.B"]);
  assert.equal(normalizeSyms(Array.from({ length: 60 }, (_, i) => "S" + i).join(",")).length, 40);
});
