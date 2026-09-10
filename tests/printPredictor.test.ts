import { test } from "node:test";
import assert from "node:assert/strict";
import {
  auc, rankData, rankIC, calibrationCurve, hitRate,
  fitLogit, featurize, reactionFromSeries, surpriseFromStats,
  buildDataset, cohorts, walkForwardRefit, FEATURE_NAMES,
  type PrintExample, type PrintFeatures, type SymbolInput,
} from "../lib/printPredictor";
import type { CallDigest, CallTone, GuidanceAction } from "../lib/callDigests";
import type { CallRecord } from "../lib/callsArchive";
import type { XY } from "../lib/types";

const DAY = 86_400_000;

// ── metrics ──────────────────────────────────────────────────────────────────
test("auc: perfect → 1, reversed → 0, single class → null, length mismatch → null", () => {
  assert.equal(auc([3, 2, 1], [1, 1, 0]), 1);
  assert.equal(auc([1, 2, 3], [1, 1, 0]), 0);
  assert.equal(auc([1, 2, 3], [1, 1, 1]), null);
  assert.equal(auc([1, 2], [1, 1, 0]), null); // guarded length mismatch
});

test("rankData: ties share the mean rank", () => {
  assert.deepEqual(rankData([10, 20, 20, 30]), [1, 2.5, 2.5, 4]);
});

test("rankIC: monotone → ±1, and CONSTANT/TIED input → null (not a spurious ±1)", () => {
  assert.equal(rankIC([1, 2, 3, 4, 5], [10, 20, 30, 40, 50]), 1);
  assert.equal(rankIC([1, 2, 3, 4, 5], [50, 40, 30, 20, 10]), -1);
  // a flat/no-signal predictor must NOT report an edge — the bug the review caught (pctRank fabricated ±1):
  assert.equal(rankIC([5, 5, 5], [1, 2, 3]), null);
  assert.equal(rankIC([5, 5, 5], [3, 2, 1]), null);
});

test("calibrationCurve: perfect probs → Brier 0; empty input → Brier null", () => {
  assert.equal(calibrationCurve([0, 1, 0, 1], [0, 1, 0, 1]).brier, 0);
  assert.equal(calibrationCurve([], []).brier, null);
});

test("hitRate: threshold classification; empty → null (renders as '—', not a real 0%)", () => {
  const r = hitRate([0.9, 0.1, 0.8, 0.2], [1, 0, 1, 0], 0.5);
  assert.equal(r.hit, 1);
  assert.equal(r.n, 4);
  const e = hitRate([], [], 0.5);
  assert.equal(e.hit, null);
  assert.equal(e.balanced, null);
});

// ── model ────────────────────────────────────────────────────────────────────
test("fitLogit: deterministic and learns a separable signal", () => {
  const feats = ["a"];
  const X: (number | null)[][] = [];
  const y: (0 | 1)[] = [];
  for (let i = 0; i < 200; i++) { const v = i - 100; X.push([v]); y.push(v > 0 ? 1 : 0); }
  const m1 = fitLogit(X, y, feats);
  const m2 = fitLogit(X, y, feats);
  assert.deepEqual(m1.w, m2.w);
  assert.equal(m1.b, m2.b);
  assert.ok(m1.w[0] > 0);
});

// ── reaction / surprise helpers ───────────────────────────────────────────────
test("reactionFromSeries: larger-of print-day / next-day move, signed %", () => {
  const daily: XY[] = [
    [Date.parse("2024-04-13T00:00:00Z"), 100],
    [Date.parse("2024-04-14T00:00:00Z"), 100],
    [Date.parse("2024-04-15T00:00:00Z"), 105],
    [Date.parse("2024-04-16T00:00:00Z"), 100],
  ];
  assert.equal(reactionFromSeries(daily, "2024-04-15"), 5);
  assert.equal(reactionFromSeries([], "2024-04-15"), null);
});

test("surpriseFromStats: latest quarter-end at/before the print within 110d", () => {
  const s = [
    { quarter: "2023-12-31", actual: 1, estimate: 1, surprisePercent: 0.01 },
    { quarter: "2024-03-31", actual: 1, estimate: 1, surprisePercent: 0.02 },
  ];
  assert.equal(surpriseFromStats(s, "2024-04-15"), 0.02);
  assert.equal(surpriseFromStats(s, "2023-06-30"), null);
});

// ── dataset pairing ────────────────────────────────────────────────────────────
function mkDigest(tone: CallTone, action: GuidanceAction, callDate: string): CallDigest {
  return {
    symbol: "TST", name: "Test", sector: "Tech", marketCap: 1e10,
    callDate, title: "T", url: "u", source: "s", tldr: "t",
    tone, guidance: { action, detail: "" },
    kpis: ["a", "b"], drivers: ["d"], qa: [{ analyst: "x", question: "q", answer: "a", directness: "evasive" }],
    readThrough: [], watch: ["w"], quotes: [], chars: 50000, chunks: 3, model: "m", digestedAt: "2024-01-01",
  };
}
function mkRec(callDate: string, fiscalPeriod: string, digest: CallDigest | null): CallRecord {
  return { symbol: "TST", fiscalPeriod, callDate, title: "T", url: "u", source: "s", transcript: { text: "x".repeat(200), chars: 200 }, digest, fetchedAt: "2024-01-01" };
}

test("buildDataset: N digested calls → N-1 consecutive pairs + 1 live point, with featureDate set", () => {
  const dates = ["2024-01-15", "2024-04-15", "2024-07-15"];
  const recs = dates.map((d, i) => mkRec(d, `2024-Q${i + 1}`, mkDigest("upbeat", "raised", d)));
  const daily: XY[] = [];
  const start = Date.parse("2024-01-01T00:00:00Z");
  for (let day = 0; day < 220; day++) {
    const ts = start + day * DAY;
    const iso = new Date(ts).toISOString().slice(0, 10);
    daily.push([ts, dates.includes(iso) ? 105 : 100]);
  }
  const surprises = [
    { quarter: "2023-12-31", actual: 1, estimate: 1, surprisePercent: 0.02 },
    { quarter: "2024-03-31", actual: 1, estimate: 1, surprisePercent: 0.02 },
    { quarter: "2024-06-30", actual: 1, estimate: 1, surprisePercent: 0.02 },
  ];
  const input: SymbolInput[] = [{ sym: "TST", sector: "Tech", recs, surprises, daily }];
  const { examples, live } = buildDataset(input);
  assert.equal(examples.length, 2);
  assert.equal(live.length, 1);
  assert.equal(live[0].callDate, "2024-07-15");
  for (const e of examples) {
    assert.equal(e.y.beat, 1);
    assert.equal(e.y.reactUp, 1);
    assert.ok(e.featureDate < e.labelDate, "featureDate (Qn call) precedes labelDate (Qn+1 print)");
  }
});

// ── the no-lookahead invariant (with the embargo) ───────────────────────────────
test("walkForwardRefit: a FUTURE cohort never changes a PAST cohort's OOS prediction", () => {
  const examples: PrintExample[] = [];
  for (let month = 0; month < 12; month++) {
    const mm = String(month + 1).padStart(2, "0");
    const labelDate = `2024-${mm}-15`;
    const featureDate = new Date(Date.parse(`${labelDate}T00:00:00Z`) - 92 * DAY).toISOString().slice(0, 10);
    for (let k = 0; k < 12; k++) {
      const x: PrintFeatures = {
        toneScore: (k % 4) - 1.5, guideDelta: (k % 3) - 1, qaDirectness: (k % 2) - 0.5,
        nKpis: k % 5, nDrivers: k % 3, nWatch: k % 2, nReadThrough: 0,
        priorSurprisePct: (k - 6) / 100, priorMovePct: k - 6,
      };
      examples.push({ symbol: "S", sector: null, featureDate, labelDate, x, y: { beat: (k % 2) as 0 | 1, reactUp: (k < 6 ? 1 : 0) as 0 | 1, movePct: k - 6 } });
    }
  }
  const coh = cohorts(examples);
  const base = walkForwardRefit(examples, coh, "beat");
  const warmup = 6;
  let before = 0;
  for (let c = warmup; c < coh.list.length - 1; c++) before += coh.list[c].idxs.length;
  for (const i of coh.list[coh.list.length - 1].idxs) examples[i].x.toneScore = 999;
  const after = walkForwardRefit(examples, coh, "beat");
  assert.ok(before > 0, "there are earlier-cohort predictions to check");
  assert.deepEqual(after.probs.slice(0, before), base.probs.slice(0, before));
});

// ── featurize encoding ─────────────────────────────────────────────────────────
test("featurize: tone/guidance encode monotonically, evasive Q&A scores negative, 9 features", () => {
  const d = mkDigest("defensive", "cut", "2024-01-15");
  const f = featurize(d, { surprisePct: 0.01, movePct: -2 });
  assert.equal(f.toneScore, -1.5);
  assert.equal(f.guideDelta, -2);
  assert.equal(f.qaDirectness, -1);
  assert.equal(FEATURE_NAMES.length, 9);
});
