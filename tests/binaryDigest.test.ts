import { test } from "node:test";
import assert from "node:assert/strict";
import { buildDigest } from "../lib/binaryDigest";
import type { BinaryEvent } from "../lib/binaryWeek";

const ev = (o: Partial<BinaryEvent>): BinaryEvent => ({
  date: "2026-07-08", daysTo: 1, kind: "earnings", ticker: "X", company: "X Co", label: "Earnings",
  impliedMovePct: null, impact: 6, hardBinary: false, ...o,
});

test("buildDigest: title, counts, markdown includes tickers + implied moves + hard-binary flag", () => {
  const d = buildDigest(
    [
      ev({ ticker: "CAPR", kind: "pdufa", label: "FDA decision (PDUFA)", detail: "Deramiocel", hardBinary: true, impliedMovePct: 38, date: "2026-07-10", daysTo: 3 }),
      ev({ ticker: "NRIX", label: "Earnings", impliedMovePct: 22, date: "2026-07-08", daysTo: 1 }),
    ],
    { weekOf: "2026-07-06", baseUrl: "https://example.com" },
  );
  assert.match(d.title, /Binary Events — week of/);
  assert.equal(d.count, 2);
  assert.equal(d.hardCount, 1);
  assert.match(d.markdown, /CAPR/);
  assert.match(d.markdown, /±38%/);
  assert.match(d.markdown, /◆/); // hard-binary marker
  assert.match(d.markdown, /example\.com\/u\/sp500\/binary-week/); // board link when baseUrl given
  assert.match(d.html, /<table/);
  assert.match(d.html, /NRIX/);
});

test("buildDigest: no baseUrl → no board link; unpriced events read 'no listed options'", () => {
  const d = buildDigest([ev({ ticker: "SRPT", kind: "readout", label: "Phase 3 readout", hardBinary: true, impliedMovePct: null })], { weekOf: "2026-07-06" });
  assert.doesNotMatch(d.markdown, /Full board/);
  assert.match(d.markdown, /no listed options/);
  assert.equal(d.hardCount, 1);
});

test("buildDigest: caps at max", () => {
  const many = Array.from({ length: 30 }, (_, i) => ev({ ticker: `T${i}` }));
  const d = buildDigest(many, { weekOf: "2026-07-06", max: 5 });
  assert.equal(d.count, 30); // count reflects all
  assert.equal((d.markdown.match(/^◆?.*T\d+/gm) || []).length <= 6, true); // only ~5 rows rendered
});
