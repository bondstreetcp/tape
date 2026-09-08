import { test } from "node:test";
import assert from "node:assert/strict";
import { parseDrop, dropToRecord } from "../lib/transcriptDrop";

const long = "We had a strong quarter with broad-based demand and raised our full-year outlook. ".repeat(3); // >100 chars

test("parseDrop: JSON needs a symbol + >=100 chars of text; carries the optional fields", () => {
  const d = parseDrop("x.json", JSON.stringify({ symbol: "stz", text: long, title: "STZ @ Barclays", date: "2026-09-08", period: "conf-2026-09", source: "Barclays Consumer", url: "u" }));
  assert.deepEqual(d, { symbol: "stz", text: long, title: "STZ @ Barclays", date: "2026-09-08", period: "conf-2026-09", source: "Barclays Consumer", url: "u" });
  assert.equal(parseDrop("x.json", JSON.stringify({ symbol: "STZ" })), null, "missing text");
  assert.equal(parseDrop("x.json", JSON.stringify({ text: long })), null, "missing symbol");
  assert.equal(parseDrop("x.json", JSON.stringify({ symbol: "STZ", text: "too short" })), null, "text under floor");
  assert.equal(parseDrop("x.json", "{not json"), null, "unparseable");
});

test("parseDrop: TXT takes the symbol (+ datey period) from the filename", () => {
  assert.deepEqual(parseDrop("STZ_2026-09-08.txt", long), { symbol: "STZ", text: long, period: "2026-09-08" });
  assert.deepEqual(parseDrop("STZ.txt", long), { symbol: "STZ", text: long, period: undefined });
  assert.equal(parseDrop("STZ.txt", "short"), null, "text under floor");
  assert.equal(parseDrop("notes.md", long), null, "unsupported extension");
});

test("dropToRecord: uppercases symbol, fills defaults, digest stays null (raw)", () => {
  const now = "2026-09-08T15:30:00.000Z";
  const r = dropToRecord({ symbol: "stz", text: long, source: "Barclays Consumer 2026", period: "conf-sep26" }, now);
  assert.equal(r.symbol, "STZ");
  assert.equal(r.fiscalPeriod, "conf-sep26");
  assert.equal(r.callDate, "2026-09-08"); // defaulted from nowISO
  assert.equal(r.title, "STZ — Barclays Consumer 2026");
  assert.equal(r.source, "Barclays Consumer 2026");
  assert.equal(r.transcript.chars, long.length);
  assert.equal(r.digest, null);
  assert.equal(r.digestedAt, null);
  // no period → key by the (defaulted) call date; no source → generic label
  const r2 = dropToRecord({ symbol: "GIS", text: long }, now);
  assert.equal(r2.fiscalPeriod, "2026-09-08");
  assert.equal(r2.source, "external transcript");
  assert.equal(r2.title, "GIS — external transcript");
});
