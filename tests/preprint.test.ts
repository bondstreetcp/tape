import { test } from "node:test";
import assert from "node:assert/strict";
import { computePreprint, RESEARCH_FRESH_D, type PublicInputs } from "../lib/research/preprint";
import type { StoredDoc } from "../lib/research/types";

// The action label + information-value verdict are pure rules — pin them so "does the research add
// edge" means one fixed, inspectable thing.

const DAY = 86_400_000;
const NOW = Date.parse("2026-07-19T00:00:00Z");
const iso = (daysAgo: number) => new Date(NOW - daysAgo * DAY).toISOString().slice(0, 10);

function doc(over: Partial<StoredDoc>): StoredDoc {
  return {
    id: "x", fileName: "", pageCount: 1, charCount: 100, ingestedAt: iso(0), blobKey: null,
    ticker: "TEST", company: "Test Co", source: "MS", analysts: [], publishDate: iso(5), docType: "note",
    title: "", rating: null, ratingPrior: null, priceTarget: null, priceTargetPrior: null, targetBasis: null,
    thesis: ["t"], risks: [], catalysts: [], managementInsights: [], estimates: [], summary: "",
    entitlement: null,
    ...over,
  };
}

const pubBase: PublicInputs = {
  recommendationMean: 2.5, targetMean: null, price: 100, epsUp30d: null, epsDown30d: null,
  tradeLean: null, sandbagger: null, richnessVerdict: null, putsBid: null,
};

test("no ingested notes → hold, 'no incremental signal', research score 0", () => {
  const r = computePreprint([], pubBase, NOW);
  assert.equal(r.action, "hold");
  assert.equal(r.infoValue.verdict, "no incremental signal");
  assert.equal(r.researchScore, 0);
  assert.equal(r.researchAxis.length, 0);
});

test("stale notes (> freshness window) count as context, not signal", () => {
  const stale = doc({ publishDate: iso(RESEARCH_FRESH_D + 10), rating: "Buy", priceTarget: 140 });
  const r = computePreprint([stale], pubBase, NOW);
  assert.equal(r.infoValue.noteCount, 1);
  assert.equal(r.infoValue.freshCount, 0);
  assert.equal(r.infoValue.verdict, "no incremental signal");
  assert.equal(r.action, "hold");
});

test("fresh bullish notes with mgmt color + vs-Street stance → add, 'adds edge'", () => {
  const d1 = doc({ source: "MS", rating: "Overweight", priceTarget: 130, managementInsights: ["CFO color on segment X"] });
  const d2 = doc({
    source: "JPM", rating: "Buy", priceTarget: 125, publishDate: iso(10),
    estimates: [{ metric: "EPS", period: "FY26", value: 5.2, priorValue: null, unit: "$/sh", vsConsensus: "4% above Street" }],
  });
  const r = computePreprint([d1, d2], { ...pubBase, recommendationMean: 2.0 }, NOW);
  assert.equal(r.action, "add");
  assert.equal(r.infoValue.verdict, "adds edge");
  assert.ok(r.researchScore >= 1, `research score should be bullish, got ${r.researchScore}`);
  assert.equal(r.infoValue.mgmtColorCount, 1);
  assert.equal(r.infoValue.divergences.length, 1);
});

test("fresh bearish notes → trim; opposed public lean drops confidence to low", () => {
  const d1 = doc({ source: "Citi", rating: "Underweight", priceTarget: 80 }); // PT below price 100 → bearish
  const d2 = doc({ source: "Stifel", rating: "Sell", priceTarget: 85, publishDate: iso(3) });
  const bullishPublic: PublicInputs = { ...pubBase, recommendationMean: 1.8, targetMean: 130 }; // public bullish
  const r = computePreprint([d1, d2], bullishPublic, NOW);
  assert.equal(r.action, "trim");
  assert.ok(r.researchScore <= -1);
  assert.ok(r.publicScore >= 1);
  assert.equal(r.confidence, "low"); // the axes fight — interesting, but size small
});

test("notes that just restate consensus → 'confirms consensus' (no mgmt color, no divergence, no PT move)", () => {
  const d = doc({ rating: "Hold", priceTarget: 102 }); // ~2% upside — no signal either way
  const r = computePreprint([d], pubBase, NOW);
  assert.equal(r.infoValue.freshCount, 1);
  assert.equal(r.infoValue.verdict, "confirms consensus");
});

test("no directional edge + rich options + puts bid → hedge", () => {
  const d = doc({ rating: "Hold", priceTarget: 101 });
  const r = computePreprint([d], { ...pubBase, richnessVerdict: "rich", putsBid: true }, NOW);
  assert.equal(r.action, "hedge");
});

test("a perfectly split corpus reads NEUTRAL, not sellish (the asymmetric-threshold regression)", () => {
  // 1 Buy vs 1 Sell: the old rule let the lone sell note (n/3 threshold) win the tie → 'trim' on a
  // corpus with zero net lean. The majority side must now also EXCEED the other side.
  const buy = doc({ source: "MS", rating: "Buy" });
  const sell = doc({ source: "Citi", rating: "Sell", publishDate: iso(3) });
  const r = computePreprint([buy, sell], pubBase, NOW);
  assert.equal(r.researchAxis[0].lean, 0);
  assert.notEqual(r.action, "trim");
});

test("a compound rating matching BOTH directions counts as neither (no double-count)", () => {
  // e.g. a mis-extracted "Buy — turning Cautious into the print" hits buyish AND sellish.
  const odd = doc({ rating: "Buy — turning Cautious" });
  const clean = doc({ source: "GS", rating: "Sell", publishDate: iso(2) });
  const r = computePreprint([odd, clean], pubBase, NOW);
  // rated=2: odd → neither (b=0), clean → s=1; s >= max(1, 2/3)=1 and s > b → sellish lean stands on
  // the CLEAN note alone; the compound note influenced nothing.
  assert.equal(r.researchAxis[0].lean, -1);
  assert.ok(r.researchAxis[0].label.startsWith("0/2"));
});

test("extended rating vocab: Accumulate/Top Pick bullish, Cautious bearish; PT-revision unit guard", () => {
  const a = doc({ source: "MS", rating: "Accumulate" });
  const b = doc({ source: "BI", rating: "Top Pick", publishDate: iso(2) });
  const r = computePreprint([a, b], pubBase, NOW);
  assert.equal(r.researchAxis[0].lean, 1);
  // A typo'd prior PT ($10 → $150 = +1400%) must not fabricate the revision axis or "adds edge".
  const typo = doc({ source: "X", rating: null, priceTarget: 150, priceTargetPrior: 10 });
  const r2 = computePreprint([typo], pubBase, NOW);
  assert.equal(r2.infoValue.ptRevisions, 0);
  assert.equal(r2.infoValue.verdict, "confirms consensus");
});

test("even-count broker PTs use the true median, not the upper-middle", () => {
  const d1 = doc({ source: "A", rating: null, priceTarget: 100 });
  const d2 = doc({ source: "B", rating: null, priceTarget: 140, publishDate: iso(2) });
  // price 100: upper-middle (140) would read +40% → bullish; the true median (120) reads +20% — still
  // bullish here, so pin the LABEL to prove the midpoint is used.
  const r = computePreprint([d1, d2], pubBase, NOW);
  const pt = r.researchAxis.find((x) => x.label.includes("PT median"));
  assert.ok(pt && pt.label.includes("$120"), `expected the $120 midpoint, got: ${pt?.label}`);
});

test("volNote mirrors the richness verdict; aligned strong signals reach high confidence", () => {
  const d1 = doc({ source: "MS", rating: "Buy", priceTarget: 130, managementInsights: ["expert call"] });
  const d2 = doc({
    source: "GS", rating: "Overweight", priceTarget: 128, priceTargetPrior: 110, publishDate: iso(2),
    estimates: [{ metric: "Rev", period: "F3Q", value: 12, priorValue: null, unit: "$B", vsConsensus: "above Street" }],
  });
  const pub: PublicInputs = { ...pubBase, recommendationMean: 1.9, targetMean: 125, richnessVerdict: "cheap" };
  const r = computePreprint([d1, d2], pub, NOW);
  assert.equal(r.action, "add");
  assert.equal(r.confidence, "high"); // |research| ≥ 2, aligned with public, ≥2 fresh notes
  assert.ok(r.volNote && /CHEAP/i.test(r.volNote));
  assert.equal(r.infoValue.ptRevisions, 1); // GS moved its PT +16%
});
