import { test } from "node:test";
import assert from "node:assert/strict";
import { dateInText, dateNearAnchor } from "../lib/biotech";

// The anti-fabrication gates for PDUFA rows: an extracted date only survives if it literally
// appears in the filing text, NEAR the drug it's claimed for. All comparisons are lowercased.

test("dateInText: accepts the common US press-release formats", () => {
  const iso = "2027-03-27";
  for (const t of [
    "the fda has set a pdufa target action date of march 27, 2027 for",
    "pdufa goal date of march 27 2027.",
    "a target action date of march 27th, 2027",
    "action date of 27 march 2027 under the pdufa",
    "pdufa date: 3/27/2027",
    "pdufa date: 03/27/2027",
    "pdufa date (2027-03-27)",
  ]) assert.equal(dateInText(iso, t), true, t);
});

test("dateInText: rejects dates that are not in the text (fabrication / quarter-only guidance)", () => {
  assert.equal(dateInText("2027-03-27", "the fda accepted the nda for review with a decision expected in the first half of 2027"), false);
  assert.equal(dateInText("2027-03-27", "pdufa target action date of march 28, 2027"), false); // off by a day
  assert.equal(dateInText("2027-03-27", "pdufa target action date of march 27, 2026"), false); // wrong year
  assert.equal(dateInText("not-a-date", "march 27, 2027"), false);
  assert.equal(dateInText("2027-13-01", "undefined 1, 2027"), false); // malformed month can't sneak through
  assert.equal(dateInText("2027-03-01", "march 1th, 2027"), false); // wrong ordinal is not a real date mention
  assert.equal(dateInText("2027-03-01", "march 1st, 2027"), true);
});

test("dateNearAnchor: the date must sit near THIS drug's name (kills cross-attribution in multi-program 8-Ks)", () => {
  const text =
    "the fda assigned a pdufa target action date of november 15, 2027 for zelfamab. " +
    "x".repeat(4000) +
    " separately, the agency set a pdufa target action date of december 1, 2027 for borvatinib in nsclc.";
  assert.equal(dateNearAnchor("2027-11-15", text, ["zelfamab"]), true);
  assert.equal(dateNearAnchor("2027-12-01", text, ["borvatinib"]), true);
  assert.equal(dateNearAnchor("2027-12-01", text, ["zelfamab"]), false); // real date, wrong drug → rejected
  assert.equal(dateNearAnchor("2027-11-15", text, ["borvatinib"]), false);
  assert.equal(dateNearAnchor("2027-11-15", text, [""]), false); // no usable anchor → no attribution
});
