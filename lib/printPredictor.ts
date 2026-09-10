/**
 * Earnings PRINT PREDICTOR — pure engine (meeting item #3).
 *
 * Turns each digested earnings call at Qn into a (features, labelA=beat/miss, labelB=reaction) example
 * labeled by the NEXT print (Qn+1), fits a transparent ridge/class-weighted logistic model, and grades it
 * WALK-FORWARD out-of-sample (expanding-window refit — coefficients never see the future). Pure & fs-free:
 * all I/O (archive, series, company cache, feed write) lives in scripts/refresh-print-predictor.ts, so this
 * module is safe to import from a client bundle (per the verify-with-next-build memo).
 *
 * No-lookahead contract: features come only from the Qn call (+ the Qn print's own reaction, known at call
 * time); labels come only from the Qn+1 print; the OOS loop refits per cohort on examples whose LABEL
 * RESOLVED BEFORE the scored cohort's feature (call) date — a real embargo, because features lead labels by
 * a full quarter (a "strictly-earlier label month" rule alone would leak ~1 quarter of not-yet-resolved
 * outcomes). See PRINT_METHOD for the honesty box.
 */
import { FLAT_MOVE_PCT, actualDirection } from "./earningsPreviewLog";
import type { WalkForward } from "./signalGrid";
import type { CallDigest, CallTone, GuidanceAction, Directness } from "./callDigests";
import type { CallRecord } from "./callsArchive";
import type { SurpriseRow } from "./companyStats";
import type { XY } from "./types";

// ── Feature / label / example types ────────────────────────────────────────────────────────────────
export interface PrintFeatures {
  toneScore: number; // upbeat +1.5 / measured +0.5 / cautious −0.5 / defensive −1.5
  guideDelta: number; // raised +2 / initiated +1 / reaffirmed 0 / mixed −1 / cut −2 / withdrawn −2 / none 0
  qaDirectness: number; // mean over qa: direct +1 / partial 0 / evasive −1 (evasiveness is the tell)
  nKpis: number;
  nDrivers: number;
  nWatch: number; // flagged risks — bearish tilt
  nReadThrough: number;
  priorSurprisePct: number | null; // the Qn print's own EPS surprise (decimal); only the recent ~4q are cached
  priorMovePct: number | null; // the Qn print's own 1-day reaction (PEAD carry), known at call time
}

export const FEATURE_NAMES: (keyof PrintFeatures)[] = [
  "toneScore", "guideDelta", "qaDirectness", "nKpis", "nDrivers", "nWatch", "nReadThrough",
  "priorSurprisePct", "priorMovePct",
];

export interface PrintLabels {
  beat: 0 | 1 | null; // surprise>band → 1, <−band → 0, inline/none → null (dropped from the binary head)
  reactUp: 0 | 1 | null; // move>flat → 1, <−flat → 0, flat/none → null (coin-flip, dropped)
  movePct: number | null; // signed 1-day reaction %, the continuous target for rank-IC
}

export interface PrintExample { symbol: string; sector: string | null; featureDate: string; labelDate: string; x: PrintFeatures; y: PrintLabels }
export interface LivePoint { symbol: string; sector: string | null; callDate: string; fiscalPeriod: string; x: PrintFeatures }

// ── Encoding constants ─────────────────────────────────────────────────────────────────────────────
const TONE_SCORE: Record<CallTone, number> = { upbeat: 1.5, measured: 0.5, cautious: -0.5, defensive: -1.5 };
const GUIDE_DELTA: Record<GuidanceAction, number> = {
  raised: 2, initiated: 1, reaffirmed: 0, mixed: -1, cut: -2, withdrawn: -2, none: 0,
};
const DIRECTNESS_SCORE: Record<Directness, number> = { direct: 1, partial: 0, evasive: -1 };

/** Digest → numeric feature vector. `prior` is the Qn print's own surprise/move (legit at call time). */
export function featurize(d: CallDigest, prior: { surprisePct: number | null; movePct: number | null }): PrintFeatures {
  const qa = d.qa || [];
  const qaDirectness = qa.length
    ? qa.reduce((s, q) => s + (DIRECTNESS_SCORE[q.directness] ?? 0), 0) / qa.length
    : 0;
  return {
    toneScore: TONE_SCORE[d.tone] ?? 0,
    guideDelta: GUIDE_DELTA[d.guidance?.action] ?? 0,
    qaDirectness,
    nKpis: (d.kpis || []).length,
    nDrivers: (d.drivers || []).length,
    nWatch: (d.watch || []).length,
    nReadThrough: (d.readThrough || []).length,
    priorSurprisePct: prior.surprisePct,
    priorMovePct: prior.movePct,
  };
}

// ── Label helpers (pure) ────────────────────────────────────────────────────────────────────────────
const DAY_MS = 86_400_000;

/** 1-day post-print reaction from a daily [ts,close] series: larger-magnitude of print-day / next-day move
 *  (the refresh-pead doctrine, since we lack the 8-K acceptance hour here). Returns signed %, or null. */
export function reactionFromSeries(daily: XY[] | undefined, dateISO: string): number | null {
  if (!daily || daily.length < 2) return null;
  const t = Date.parse(`${dateISO}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  const i = daily.findIndex(([ts]) => ts >= t);
  if (i < 1) return null; // not found (-1) or no prior close (0)
  const c0 = daily[i - 1][1], c1 = daily[i][1];
  const dayMove = c0 && c1 ? c1 / c0 - 1 : null;
  const c2 = i + 1 < daily.length ? daily[i + 1][1] : null;
  const nextMove = c1 && c2 ? c2 / c1 - 1 : null;
  const cand = [dayMove, nextMove].filter((x): x is number => x != null && Number.isFinite(x));
  if (!cand.length) return null;
  const best = cand.reduce((a, b) => (Math.abs(b) > Math.abs(a) ? b : a));
  return +(best * 100).toFixed(2);
}

/** Latest EPS surprise (decimal) whose fiscal quarter-end is at/before the print date within 110d. */
export function surpriseFromStats(surprises: SurpriseRow[] | undefined, dateISO: string): number | null {
  if (!surprises?.length) return null;
  const t = Date.parse(`${dateISO}T00:00:00Z`);
  if (Number.isNaN(t)) return null;
  let best: SurpriseRow | null = null;
  let bestT = -Infinity;
  for (const s of surprises) {
    const qt = Date.parse(`${s.quarter || ""}T00:00:00Z`);
    if (Number.isNaN(qt)) continue;
    if (qt <= t + DAY_MS && t - qt <= 110 * DAY_MS && qt > bestT) { best = s; bestT = qt; }
  }
  return best && best.surprisePercent != null ? best.surprisePercent : null;
}

const beatLabel = (surprisePct: number | null): 0 | 1 | null => {
  const dir = actualDirection(surprisePct);
  return dir === "beat" ? 1 : dir === "miss" ? 0 : null;
};
const reactLabel = (movePct: number | null): 0 | 1 | null =>
  movePct == null ? null : Math.abs(movePct) < FLAT_MOVE_PCT ? null : movePct > 0 ? 1 : 0;

// ── Dataset / pairing builder ────────────────────────────────────────────────────────────────────────
export interface SymbolInput {
  sym: string; sector: string | null;
  recs: CallRecord[]; surprises: SurpriseRow[] | undefined; daily: XY[] | undefined;
}
export interface BaseRates { beat: number | null; up: number | null; nBeat: number; nUp: number }

const PAIR_MIN_DAYS = 55; // a genuine consecutive-quarter pair is ~one fiscal quarter apart; guard missing prints
const PAIR_MAX_DAYS = 135; // > this means a middle quarter was undigested → would mispair Qn→Qn+2, so drop

export function buildDataset(perSymbol: SymbolInput[]): { examples: PrintExample[]; live: LivePoint[]; baseRates: BaseRates } {
  const examples: PrintExample[] = [];
  const live: LivePoint[] = [];
  for (const s of perSymbol) {
    const recs = s.recs
      .filter((r) => r.digest)
      .sort((a, b) => (a.callDate || "").localeCompare(b.callDate || "")); // ascending by call date
    for (let i = 0; i < recs.length; i++) {
      const cur = recs[i];
      const x = featurize(cur.digest!, {
        surprisePct: surpriseFromStats(s.surprises, cur.callDate),
        movePct: reactionFromSeries(s.daily, cur.callDate),
      });
      const next = recs[i + 1];
      if (!next) { // newest digested call → the forward (unlabeled) prediction the card shows
        live.push({ symbol: s.sym, sector: s.sector, callDate: cur.callDate, fiscalPeriod: cur.fiscalPeriod, x });
        continue;
      }
      const gap = Math.round((Date.parse(next.callDate) - Date.parse(cur.callDate)) / DAY_MS);
      if (!(gap >= PAIR_MIN_DAYS && gap <= PAIR_MAX_DAYS)) continue; // not truly consecutive quarters
      const labelMove = reactionFromSeries(s.daily, next.callDate);
      const y: PrintLabels = {
        beat: beatLabel(surpriseFromStats(s.surprises, next.callDate)),
        reactUp: reactLabel(labelMove),
        movePct: labelMove,
      };
      if (y.beat == null && y.reactUp == null) continue; // no usable label
      // featureDate = the Qn call (when the features are knowable); labelDate = the Qn+1 print (the outcome).
      examples.push({ symbol: s.sym, sector: s.sector, featureDate: cur.callDate, labelDate: next.callDate, x, y });
    }
  }
  const beats = examples.map((e) => e.y.beat).filter((v): v is 0 | 1 => v != null);
  const ups = examples.map((e) => e.y.reactUp).filter((v): v is 0 | 1 => v != null);
  const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
  return {
    examples, live,
    baseRates: { beat: mean(beats), up: mean(ups), nBeat: beats.length, nUp: ups.length },
  };
}

// ── Model: ridge, class-weighted logistic regression (deterministic) ──────────────────────────────────
export interface LinModel {
  features: string[]; mean: number[]; sd: number[]; w: number[]; b: number;
  l2: number; nTrain: number; posRate: number;
  oddsRatios: { feature: string; coef: number; oddsRatio: number }[];
}

export const featureVec = (x: PrintFeatures, featNames: string[]): (number | null)[] =>
  featNames.map((f) => (x as unknown as Record<string, number | null>)[f] ?? null);

const sigmoid = (z: number): number => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));

export function fitLogit(
  X: (number | null)[][], y: (0 | 1)[], featNames: string[],
  opts: { l2?: number; steps?: number; lr?: number; classWeight?: boolean } = {},
): LinModel {
  const l2 = opts.l2 ?? 1, steps = opts.steps ?? 400, lr = opts.lr ?? 0.1, cw = opts.classWeight ?? true;
  const n = X.length, p = featNames.length;
  const mean = new Array(p).fill(0), sd = new Array(p).fill(1);
  for (let j = 0; j < p; j++) {
    const col = X.map((r) => r[j]).filter((v): v is number => v != null && Number.isFinite(v));
    if (col.length) {
      const m = col.reduce((a, b) => a + b, 0) / col.length;
      const v = col.reduce((a, b) => a + (b - m) * (b - m), 0) / col.length;
      mean[j] = m; sd[j] = v > 1e-12 ? Math.sqrt(v) : 1;
    }
  }
  const z = (v: number | null, j: number) => (v == null || !Number.isFinite(v) ? 0 : (v - mean[j]) / sd[j]);
  const Z = X.map((r) => r.map((v, j) => z(v, j)));
  const nPos = y.reduce((a: number, b) => a + b, 0), nNeg = n - nPos;
  const wPos = cw && nPos ? n / (2 * nPos) : 1, wNeg = cw && nNeg ? n / (2 * nNeg) : 1;
  const w = new Array(p).fill(0);
  let b = 0;
  for (let it = 0; it < steps; it++) {
    const gw = new Array(p).fill(0);
    let gb = 0, wsum = 0;
    for (let i = 0; i < n; i++) {
      let s = b;
      for (let j = 0; j < p; j++) s += w[j] * Z[i][j];
      const cwi = y[i] ? wPos : wNeg;
      const err = cwi * (sigmoid(s) - y[i]);
      for (let j = 0; j < p; j++) gw[j] += err * Z[i][j];
      gb += err; wsum += cwi;
    }
    const norm = wsum || n;
    for (let j = 0; j < p; j++) w[j] -= lr * (gw[j] / norm + l2 * w[j]);
    b -= lr * (gb / norm);
  }
  const oddsRatios = featNames
    .map((f, j) => ({ feature: f, coef: w[j], oddsRatio: Math.exp(w[j]) }))
    .sort((a, b2) => Math.abs(b2.coef) - Math.abs(a.coef));
  return { features: featNames, mean, sd, w, b, l2, nTrain: n, posRate: n ? nPos / n : 0, oddsRatios };
}

export function predictProb(m: LinModel, x: PrintFeatures): number {
  const v = featureVec(x, m.features);
  let s = m.b;
  for (let j = 0; j < m.features.length; j++) {
    const raw = v[j];
    s += m.w[j] * (raw == null || !Number.isFinite(raw) ? 0 : (raw - m.mean[j]) / m.sd[j]);
  }
  return sigmoid(s);
}

/** Per-symbol "why": the standardized features contributing most to this prediction's logit. */
export function topContributors(m: LinModel, x: PrintFeatures, k = 3): { feature: string; z: number; contribPp: number }[] {
  const v = featureVec(x, m.features);
  return m.features
    .map((f, j) => {
      const raw = v[j];
      const zj = raw == null || !Number.isFinite(raw) ? 0 : (raw - m.mean[j]) / m.sd[j];
      return { feature: f, z: zj, contrib: m.w[j] * zj };
    })
    .sort((a, b) => Math.abs(b.contrib) - Math.abs(a.contrib))
    .slice(0, k)
    .map((c) => ({ feature: c.feature, z: +c.z.toFixed(2), contribPp: +(c.contrib * 100).toFixed(1) }));
}

export interface PublishedModel { oddsRatios: { feature: string; coef: number; oddsRatio: number }[]; nTrain: number; posRate: number; l2: number }
export const publishModel = (m: LinModel): PublishedModel => ({
  oddsRatios: m.oddsRatios.map((o) => ({ feature: o.feature, coef: +o.coef.toFixed(4), oddsRatio: +o.oddsRatio.toFixed(3) })),
  nTrain: m.nTrain, posRate: +m.posRate.toFixed(4), l2: m.l2,
});

// ── Metrics (NEW — none existed in-repo): AUC, rank-IC, hit-rate, calibration ─────────────────────────
/** Average (fractional) ranks, 1..n; ties share the mean rank. */
export function rankData(xs: number[]): number[] {
  const idx = xs.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const r = new Array(xs.length).fill(0);
  let i = 0;
  while (i < idx.length) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1].v === idx[i].v) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k].i] = avg;
    i = j + 1;
  }
  return r;
}

/** AUC via Mann–Whitney U == P(score(pos) > score(neg)). null if either class is empty or lengths differ. */
export function auc(scores: number[], labels: (0 | 1)[]): number | null {
  if (scores.length !== labels.length) return null;
  const pos = labels.filter((l) => l === 1).length, neg = labels.length - pos;
  if (!pos || !neg) return null;
  const r = rankData(scores);
  let sumPos = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i] === 1) sumPos += r[i];
  const u = sumPos - (pos * (pos + 1)) / 2;
  return +(u / (pos * neg)).toFixed(4);
}

const pearson = (a: number[], b: number[]): number | null => {
  const n = a.length;
  if (n < 2 || n !== b.length) return null;
  const ma = a.reduce((x, y) => x + y, 0) / n, mb = b.reduce((x, y) => x + y, 0) / n;
  let num = 0, da = 0, db = 0;
  for (let i = 0; i < n; i++) { const x = a[i] - ma, y = b[i] - mb; num += x * y; da += x * x; db += y * y; }
  const d = Math.sqrt(da * db);
  return d > 1e-12 ? +(num / d).toFixed(4) : null; // constant input → no variance → null (not a spurious ±1)
};

/** Spearman rank-IC. Uses rankData (average ranks) — NOT pctRank, which ranks by sort position and would
 *  fabricate variance for tied/constant inputs, reporting a spurious ±1 IC for a no-signal model. */
export function rankIC(preds: number[], labels: number[]): number | null {
  if (preds.length < 3 || preds.length !== labels.length) return null;
  return pearson(rankData(preds), rankData(labels));
}

export function hitRate(probs: number[], labels: (0 | 1)[], thresh: number): { hit: number | null; balanced: number | null; n: number } {
  const n = labels.length;
  if (!n) return { hit: null, balanced: null, n: 0 };
  let correct = 0, tp = 0, tn = 0, pos = 0, neg = 0;
  for (let i = 0; i < n; i++) {
    const pred = probs[i] >= thresh ? 1 : 0;
    if (pred === labels[i]) correct++;
    if (labels[i] === 1) { pos++; if (pred === 1) tp++; } else { neg++; if (pred === 0) tn++; }
  }
  const sens = pos ? tp / pos : 0, spec = neg ? tn / neg : 0;
  return { hit: +(correct / n).toFixed(4), balanced: +((sens + spec) / 2).toFixed(4), n };
}

export interface CalBin { lo: number; hi: number; predMean: number; empFreq: number; n: number }
export function calibrationCurve(probs: number[], labels: (0 | 1)[], bins = 10): { bins: CalBin[]; brier: number | null; reliability: number | null } {
  const out: CalBin[] = [];
  let brier = 0;
  for (let i = 0; i < labels.length; i++) brier += (probs[i] - labels[i]) ** 2;
  let rel = 0, relN = 0;
  for (let bi = 0; bi < bins; bi++) {
    const lo = bi / bins, hi = (bi + 1) / bins;
    const members = probs.map((p, i) => ({ p, i })).filter((o) => (bi === bins - 1 ? o.p >= lo && o.p <= hi : o.p >= lo && o.p < hi));
    const nb = members.length;
    if (!nb) { out.push({ lo, hi, predMean: (lo + hi) / 2, empFreq: (lo + hi) / 2, n: 0 }); continue; } // empty → diagonal, n=0 signals "ignore"
    const predMean = members.reduce((s, o) => s + o.p, 0) / nb;
    const empFreq = members.reduce((s, o) => s + labels[o.i], 0) / nb;
    out.push({ lo, hi, predMean: +predMean.toFixed(4), empFreq: +empFreq.toFixed(4), n: nb });
    rel += nb * Math.abs(predMean - empFreq); relN += nb;
  }
  return { bins: out, brier: labels.length ? +(brier / labels.length).toFixed(4) : null, reliability: relN ? +(rel / relN).toFixed(4) : null };
}

// ── Walk-forward, out-of-sample (expanding-window refit with a real embargo; no lookahead) ────────────
export interface Cohort { key: string; idxs: number[] }
export function cohorts(examples: PrintExample[]): { list: Cohort[] } {
  const m = new Map<string, number[]>();
  examples.forEach((e, i) => {
    const k = (e.labelDate || "").slice(0, 7); // YYYY-MM
    if (!k) return;
    const arr = m.get(k);
    if (arr) arr.push(i); else m.set(k, [i]);
  });
  return { list: [...m.keys()].sort().map((k) => ({ key: k, idxs: m.get(k)! })) };
}

/** Top-tercile minus bottom-tercile mean movePct (pp), ranked by predicted prob. */
function longShortEdge(pred: number[], move: number[]): number | null {
  const n = pred.length;
  if (n < 6) return null;
  const order = pred.map((p, i) => ({ p, i })).sort((a, b) => a.p - b.p);
  const t = Math.floor(n / 3);
  if (t < 1) return null;
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const bottom = mean(order.slice(0, t).map((o) => move[o.i]));
  const top = mean(order.slice(n - t).map((o) => move[o.i]));
  return +(top - bottom).toFixed(3);
}

export interface OosResult {
  probs: number[]; labels: (0 | 1)[]; move: number[];
  perCohortIC: number[]; perCohortEdge: number[]; nCohorts: number; nOOS: number;
}

/** Expanding-window walk-forward with an embargo: for each cohort after warmup, refit ONLY on examples whose
 *  label RESOLVED before the earliest feature (call) date in the scored cohort — so a live model acting at
 *  the call could actually have trained on them. head = which label to fit. */
export function walkForwardRefit(
  examples: PrintExample[], coh: { list: Cohort[] }, head: "beat" | "reactUp",
  opts: { warmupCohorts?: number; l2?: number; featNames?: string[]; minTrain?: number } = {},
): OosResult {
  const warmup = opts.warmupCohorts ?? 6;
  const minTrain = opts.minTrain ?? 30;
  const featNames = opts.featNames ?? (FEATURE_NAMES as string[]);
  const labOf = (e: PrintExample) => (head === "beat" ? e.y.beat : e.y.reactUp);
  const probs: number[] = [], labels: (0 | 1)[] = [], move: number[] = [], perCohortIC: number[] = [], perCohortEdge: number[] = [];
  for (let c = warmup; c < coh.list.length; c++) {
    const cohort = coh.list[c];
    // Decision boundary = the earliest feature (call) date in this cohort. Train only on labels resolved
    // before it — features lead labels by a full quarter, so "earlier label MONTH" alone would leak the
    // most recent ~quarter of outcomes that hadn't happened yet at the scored calls' decision time.
    let boundary = "";
    for (const i of cohort.idxs) { const fd = examples[i].featureDate; if (fd && (!boundary || fd < boundary)) boundary = fd; }
    if (!boundary) continue;
    const train: { x: PrintFeatures; y: 0 | 1 }[] = [];
    for (const e of examples) {
      if (!(e.labelDate < boundary)) continue; // label must have resolved before we decide on this cohort
      const l = labOf(e);
      if (l != null) train.push({ x: e.x, y: l });
    }
    if (train.length < minTrain) continue;
    const yv = train.map((r) => r.y);
    if (yv.every((v) => v === yv[0])) continue; // single-class train window
    const m = fitLogit(train.map((r) => featureVec(r.x, featNames)), yv, featNames, { l2: opts.l2 ?? 1 });
    const cp: number[] = [], cm: number[] = [];
    for (const i of cohort.idxs) {
      const e = examples[i];
      const l = labOf(e);
      if (l == null) continue;
      const pr = predictProb(m, e.x);
      probs.push(pr); labels.push(l);
      if (e.y.movePct != null) { move.push(e.y.movePct); cp.push(pr); cm.push(e.y.movePct); } // don't coerce missing moves to 0
    }
    if (cp.length >= 20) {
      const ic = rankIC(cp, cm);
      if (ic != null) perCohortIC.push(ic);
      const edge = longShortEdge(cp, cm);
      if (edge != null) perCohortEdge.push(edge);
    }
  }
  return { probs, labels, move, perCohortIC, perCohortEdge, nCohorts: Math.max(0, coh.list.length - warmup), nOOS: labels.length };
}

// ── Published feed shape ─────────────────────────────────────────────────────────────────────────────
export interface OosBlock {
  auc: number | null; hit: number | null; balanced: number | null; brier: number | null; reliability: number | null;
  calibration: CalBin[]; nOOS: number; cohorts: number;
  rankIC?: number | null; rankICCI?: [number, number] | null; longShortEdge?: number | null; edgeCI?: [number, number] | null;
}
export interface LivePrediction {
  symbol: string; name: string; sector: string | null; callDate: string; fiscalPeriod: string;
  predBeatProb: number | null; predReactUpProb: number | null;
  topContributors: { feature: string; z: number; contribPp: number }[];
  confidence: "high" | "medium" | "low";
}
export interface PrintPredictorFile {
  generatedAt: string; universe: string; trainedThrough: string | null;
  baseRates: { beat: number | null; up: number | null };
  models: { beatMiss: PublishedModel; reaction: PublishedModel };
  oos: { beatMiss: OosBlock; reaction: OosBlock; walkForward: WalkForward | null; verdict: string };
  live: LivePrediction[];
  method: string[];
}

export const PRINT_METHOD: string[] = [
  "Features are as-of each earnings CALL (Qn); both labels are the NEXT print (Qn+1), a full quarter forward — no lookahead.",
  "Beat/miss label = sign of the reported EPS surprise from the local company cache (~4 quarters of Yahoo history) — SHALLOW. The reaction head carries the deeper backtest.",
  "Reaction label = the 1-day post-print move from the local daily series, taken as the larger of the print-day / next-day move (we lack the 8-K acceptance hour here, so a borderline before-open vs after-close print can be attributed to the wrong session).",
  "priorSurprisePct is only populated for the recent ~4-quarter cache window; before that it is imputed neutral, so its published coefficient reflects that recent window only.",
  "Model = ridge, class-weighted logistic regression on standardized features; the odds ratios ARE the thesis. Deterministic (fixed GD steps).",
  "Out-of-sample = expanding-window refit by monthly cohort, EMBARGOED: each model trains only on prints that had resolved before the scored cohort's call dates — because features lead labels by a quarter, this drops the most recent ~quarter of training labels rather than leaking them.",
  "Survivorship: the universe is TODAY's index members applied historically — delisted/acquired names (the miss-and-crash tail) are absent, so every number is an optimistic upper bound.",
  "No trading costs or slippage. AUC 0.5 / rank-IC 0 / a confidence interval straddling 0 = no edge.",
];
