import { test } from "node:test";
import assert from "node:assert/strict";
import { compGuideWindows, sanitizeCompGuide } from "../lib/compGuide";

// sanitizeCompGuide is the code-verifies guard between the model's reply and SssTicker.guide — a fabricated
// comp guide would feed the stack analyzer a wrong "implied Q4" with a straight face. Every figure must be
// literally in the release, the quote must ground, and only a comparable-sales metric qualifies.

const TEXT = `Five Below, Inc. Announces Second Quarter Fiscal 2026 Financial Results
PHILADELPHIA, Sept. 2, 2026 — For the thirteen weeks ended August 1, 2026, net sales increased 22.9% to $1.26 billion;
comparable sales increased 14.1%. For the twenty-six weeks, comparable sales increased 18.3%.
Outlook. For the third quarter of fiscal 2026, net sales are expected to be $1.21 billion to $1.23 billion with
comparable sales expected to increase 8% to 10%. For the full year of fiscal 2026, the Company now expects net sales of
$5.63 billion to $5.71 billion and comparable sales growth of 10% to 12%, versus its prior outlook of 6% to 8%, with
approximately 150 net new stores.`;
const SRC = { accession: "0001177609-26-000020", date: "2026-09-02", url: "https://sec.gov/q2" };
const GOOD = {
  metricLabel: "comparable sales",
  nextQ: { label: "Q3 FY26", compLow: 8, compHigh: 10, revLowM: 1210, revHighM: 1230, quote: "net sales are expected to be $1.21 billion to $1.23 billion with comparable sales expected to increase 8% to 10%" },
  fy: { label: "FY2026", compLow: 10, compHigh: 12, priorCompLow: 6, priorCompHigh: 8, revLowM: 5630, revHighM: 5710, quote: "comparable sales growth of 10% to 12%" },
  ytdComp: 18.3, netNewUnits: 150, confidence: "high",
};

test("a fully grounded reply is stored whole", () => {
  const g = sanitizeCompGuide(GOOD, TEXT, SRC);
  assert.ok(g);
  assert.equal(g.accession, SRC.accession);
  assert.deepEqual([g.nextQ?.compLow, g.nextQ?.compHigh, g.nextQ?.revLowM, g.nextQ?.revHighM], [8, 10, 1210, 1230]);
  assert.deepEqual([g.fy?.compLow, g.fy?.compHigh, g.fy?.priorCompLow, g.fy?.priorCompHigh, g.fy?.revLowM, g.fy?.revHighM], [10, 12, 6, 8, 5630, 5710]);
  assert.equal(g.fy?.label, "FY2026");
  assert.ok(g.nextQ?.quote && g.fy?.quote);
  assert.equal(g.ytdComp, 18.3);
  assert.equal(g.netNewUnits, 150);
  assert.equal(g.confidence, "high");
  assert.equal(g.metricLabel, "comparable sales");
});

test("a comp bound that is NOT in the release drops the whole range (never a half-range); the $ guide survives", () => {
  const g = sanitizeCompGuide({ ...GOOD, nextQ: { ...GOOD.nextQ, compHigh: 11 } }, TEXT, SRC);
  assert.ok(g?.nextQ);
  assert.equal(g.nextQ.compLow, null);
  assert.equal(g.nextQ.compHigh, null);
  assert.equal(g.nextQ.revLowM, 1210);
});

test("an ungrounded $ figure (the model computed it) is dropped", () => {
  const g = sanitizeCompGuide({ ...GOOD, fy: { ...GOOD.fy, revLowM: 5650, revHighM: 5710 } }, TEXT, SRC);
  assert.equal(g?.fy?.revLowM, null);
  assert.equal(g?.fy?.revHighM, null);
  assert.equal(g?.fy?.compLow, 10); // the comp range is untouched
});

test("a non-comp metric label disqualifies the % ranges but keeps the $ ranges", () => {
  const g = sanitizeCompGuide({ ...GOOD, metricLabel: "net sales growth" }, TEXT, SRC);
  assert.ok(g?.fy);
  assert.equal(g.fy.compLow, null);
  assert.equal(g.fy.revLowM, 5630);
  assert.equal(g.nextQ?.compLow, null);
});

test("swapped bounds are re-ordered; an implausible comp (>60%) is rejected", () => {
  const g = sanitizeCompGuide({ ...GOOD, fy: { ...GOOD.fy, compLow: 12, compHigh: 10 } }, TEXT, SRC);
  assert.deepEqual([g?.fy?.compLow, g?.fy?.compHigh], [10, 12]);
  const bad = sanitizeCompGuide({ ...GOOD, fy: { ...GOOD.fy, compLow: 10, compHigh: 75 } }, TEXT, SRC);
  assert.equal(bad?.fy?.compLow, null);
});

test("a qualitative outlook keeps the grounded quote with no numbers; 'flat' grounds a zero bound", () => {
  const text = "Outlook: we expect comparable sales to be flat to up 2% for the year, a low-single-digit comp.";
  const g = sanitizeCompGuide({ metricLabel: "comparable sales", nextQ: { label: "Q3", compLow: null, compHigh: null, quote: "a low-single-digit comp" }, fy: { label: "FY", compLow: 0, compHigh: 2, quote: "flat to up 2% for the year" }, confidence: "high" }, text, SRC);
  assert.ok(g);
  assert.equal(g.nextQ?.compLow, null);
  assert.equal(g.nextQ?.quote, "a low-single-digit comp");
  assert.deepEqual([g.fy?.compLow, g.fy?.compHigh], [0, 2]);
});

test("a quote that is not in the release is dropped, and 'high' confidence without a citable line becomes 'medium'", () => {
  const g = sanitizeCompGuide({ ...GOOD, nextQ: { ...GOOD.nextQ, quote: "comps will be spectacular" }, fy: { ...GOOD.fy, quote: null } }, TEXT, SRC);
  assert.equal(g?.nextQ?.quote, null);
  assert.equal(g?.confidence, "medium");
});

test("a well-formed reply with nothing in it is an EMPTY guide (stamped — 'checked, none'); garbage is null (retry)", () => {
  const empty = sanitizeCompGuide({ metricLabel: null, nextQ: null, fy: null, ytdComp: null, netNewUnits: null, confidence: "low" }, TEXT, SRC);
  assert.ok(empty);
  assert.equal(empty.nextQ, null);
  assert.equal(empty.fy, null);
  assert.equal(sanitizeCompGuide("not json", TEXT, SRC), null);
  assert.equal(sanitizeCompGuide(null, TEXT, SRC), null);
  assert.ok(sanitizeCompGuide([GOOD], TEXT, SRC)?.fy); // an array-wrapped object is unwrapped
});

test("compGuideWindows: keeps the header (the dateline) and the outlook paragraph, within the cap", () => {
  const filler = "Store count and other disclosures. ".repeat(600);
  const w = compGuideWindows(filler + TEXT, 300, 6000);
  assert.ok(w.length <= 6000);
  assert.match(w, /^Store count/); // header first
  assert.match(w, /comparable sales growth of 10% to 12%/); // the outlook window made it in
});
