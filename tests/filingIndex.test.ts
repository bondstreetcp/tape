import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildEmbedText, cosineSim, topKRelated, encodeVec, decodeVec, mergeIndexAccumulate,
  type FilingVec, type FilingMeta,
} from "../lib/filingIndex";

const approx = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);
const meta = (o: Partial<FilingMeta>): FilingMeta => ({ accession: "0-0", ticker: "T", form: "8-K", filedAt: "2026-01-01", headline: "h", url: "u", ...o });

// ── cosineSim ──────────────────────────────────────────────────────────────────────────────────
test("cosineSim: orthogonal 0, identical 1, opposite −1, 45° = 1/√2", () => {
  approx(cosineSim([1, 0, 0], [0, 1, 0]), 0);
  approx(cosineSim([0.3, -0.7, 0.1], [0.3, -0.7, 0.1]), 1);
  approx(cosineSim([1, 0], [-1, 0]), -1);
  approx(cosineSim([1, 0, 0], [1, 1, 0]), 1 / Math.SQRT2); // dot 1 / (1 · √2)
  assert.equal(cosineSim([0, 0], [1, 1]), 0); // zero vector → 0, never NaN
  assert.equal(cosineSim([1, 0, 0], [1]), 0); // length mismatch → 0, never a misleading prefix cosine
});

// ── int8 codec ────────────────────────────────────────────────────────────────────────────────
test("encode/decode roundtrip within the int8 scale tolerance; base64 is far smaller than JSON floats", () => {
  const v = new Float32Array(384);
  for (let i = 0; i < 384; i++) v[i] = Math.sin(i) * 0.13; // realistic small-magnitude embedding components
  const { b, s } = encodeVec(v);
  const back = decodeVec(b, s);
  assert.equal(back.length, 384);
  for (let i = 0; i < 384; i++) assert.ok(Math.abs(back[i] - v[i]) <= s / 127 + 1e-7, `comp ${i}`);
  approx(cosineSim(v, back), 1, 2e-3); // quantization preserves direction (cosine ~1)
  assert.ok(b.length < JSON.stringify(Array.from(v)).length / 2, "base64 int8 << JSON float array");
});

test("encodeVec uses the full int8 range via per-vector scale (tiny-magnitude vectors keep resolution)", () => {
  const v = [0.02, -0.04, 0.01, 0.03]; // all << 1: a fixed 127 scale would crush these to ±2..5
  const { b, s } = encodeVec(v);
  approx(s, 0.04, 1e-9); // scale = max|component|
  const back = decodeVec(b, s);
  approx(cosineSim(v, back), 1, 1e-3);
});

// ── topKRelated ──────────────────────────────────────────────────────────────────────────────
test("topKRelated: k nearest by cosine, self excluded, sub-minScore dropped, deterministic order", () => {
  const cand = [
    { meta: meta({ accession: "A" }), vec: [0.9, 0.1, 0] }, // self (excluded by accession)
    { meta: meta({ accession: "B" }), vec: [0.8, 0.6, 0] }, // cos 0.8
    { meta: meta({ accession: "C" }), vec: [0.6, 0.8, 0] }, // cos 0.6
    { meta: meta({ accession: "D" }), vec: [0, 1, 0] },     // cos 0 → below minScore, dropped
  ];
  const r = topKRelated([1, 0, 0], cand, { k: 2, minScore: 0.2, excludeAccession: "A" });
  assert.deepEqual(r.map((x) => x.accession), ["B", "C"]);
  approx(r[0].score, 0.8, 1e-4);
});

test("topKRelated: a sub-threshold duplicate accession does NOT suppress a later qualifying one", () => {
  const cand = [
    { meta: meta({ accession: "DUP" }), vec: [0, 1, 0] }, // cos 0 → below minScore, must NOT claim DUP
    { meta: meta({ accession: "DUP" }), vec: [1, 0, 0] }, // cos 1 → the real match for this accession
  ];
  const r = topKRelated([1, 0, 0], cand, { k: 5, minScore: 0.5, excludeAccession: "SELF" });
  assert.equal(r.length, 1);
  assert.equal(r[0].accession, "DUP");
  approx(r[0].score, 1, 1e-4);
});

test("topKRelated: excludeTicker accepts a SET (all co-filers of a joint filing excluded)", () => {
  const cand = [
    { meta: meta({ accession: "A", ticker: "AAA" }), vec: [1, 0] },
    { meta: meta({ accession: "B", ticker: "BBB" }), vec: [1, 0] },
    { meta: meta({ accession: "C", ticker: "CCC" }), vec: [1, 0] },
  ];
  const r = topKRelated([1, 0], cand, { k: 5, minScore: 0.5, excludeTicker: new Set(["AAA", "BBB"]) });
  assert.deepEqual(r.map((x) => x.ticker), ["CCC"]);
});

test("topKRelated: excludeTicker surfaces OTHER companies; ties break by newest then accession", () => {
  const cand = [
    { meta: meta({ accession: "S", ticker: "SELF" }), vec: [1, 0] },        // same ticker → excluded
    { meta: meta({ accession: "X", ticker: "AAA", filedAt: "2026-02-01" }), vec: [1, 0] }, // cos 1, newer
    { meta: meta({ accession: "Y", ticker: "BBB", filedAt: "2026-01-01" }), vec: [1, 0] }, // cos 1, older
  ];
  const r = topKRelated([1, 0], cand, { k: 5, minScore: 0.5, excludeTicker: "SELF" });
  assert.deepEqual(r.map((x) => x.accession), ["X", "Y"]); // tie on score → newer filedAt first
});

// ── buildEmbedText ─────────────────────────────────────────────────────────────────────────────
test("buildEmbedText: deterministic concat; NONE/empty → ''; keyMetrics JSON appended only when present", () => {
  assert.equal(
    buildEmbedText({ headline: "NSA sets July 22 closing", whatChanged: ["a.", "b."], decisionTakeaway: "moving to close", keyMetrics: { ratio: "0.14" } }),
    'NSA sets July 22 closing a. b. moving to close {"ratio":"0.14"}',
  );
  assert.equal(buildEmbedText({ headline: "NONE", whatChanged: [], keyMetrics: {} }), "");
  assert.equal(buildEmbedText({ headline: "Deal announced", keyMetrics: {} }), "Deal announced"); // empty metrics → no tail
  assert.equal(buildEmbedText({ headline: "  spaced   out  ", whatChanged: ["x"] }), "spaced out x"); // whitespace collapsed
});

// ── mergeIndexAccumulate ─────────────────────────────────────────────────────────────────────
const fv = (o: Partial<FilingVec>): FilingVec => ({ accession: "0", ticker: "T", form: "8-K", filedAt: "2026-01-01", headline: "h", url: "u", v: "", s: 1, related: [], ...o });

test("mergeIndexAccumulate: fresh wins on a dup accession; newest-first; keep prunes the oldest", () => {
  const prior = [fv({ accession: "A", v: "OLD", filedAt: "2026-05-01" }), fv({ accession: "C", filedAt: "2026-04-01" })];
  const fresh = [fv({ accession: "A", v: "NEW", filedAt: "2026-05-01" }), fv({ accession: "B", filedAt: "2026-06-01" })];
  const merged = mergeIndexAccumulate(prior, fresh, 10);
  assert.deepEqual(merged.map((r) => r.accession), ["B", "A", "C"]); // newest filedAt first
  assert.equal(merged.find((r) => r.accession === "A")!.v, "NEW"); // fresh vector wins
  assert.equal(merged.length, 3);
  const capped = mergeIndexAccumulate(prior, fresh, 2);
  assert.deepEqual(capped.map((r) => r.accession), ["B", "A"]); // oldest (C) pruned
});

// ── the slice-2 novelty primitive is already exercised by the cosine math above ────────────────
test("novelty primitive: 1 − max cosine to prior filings (verified before the feature ships)", () => {
  const query = [1, 0, 0];
  const priorSame = [{ meta: meta({ accession: "P1" }), vec: [0.95, 0.31, 0] }]; // near-duplicate language
  const nearest = topKRelated(query, priorSame, { k: 1, minScore: 0 })[0];
  const novelty = 1 - nearest.score;
  approx(novelty, 1 - cosineSim(query, [0.95, 0.31, 0]), 1e-4);
  assert.ok(novelty < 0.1, "near-duplicate filing → low novelty");
});
