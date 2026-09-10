/**
 * Builds data/earnings-print-predictor.json — the beat/miss + post-call-reaction predictor (meeting #3).
 *
 * Features come from each DIGESTED call at Qn; labels come from the NEXT print (Qn+1): beat/miss (local
 * cachedStats EPS surprise, ~4q shallow) and the 1-day reaction (local daily series, deep). A ridge,
 * class-weighted LOGISTIC model per head, graded WALK-FORWARD out-of-sample (expanding-window refit — the
 * coefficients never see the future) with AUC / rank-IC / hit-rate / calibration. Compute-over-owned-data:
 * no network, no LLM. All the math + the honesty box live in lib/printPredictor (pure, unit-tested).
 *
 * Scope with PRINT_PREDICTOR_UNIVERSES (default sp500); needs the digested call archive (data/calls/,
 * filled by ingest-transcripts) + the per-stock cache + the series store, so it runs in a FULL tick after
 * those. Run: npm run refresh-print-predictor.
 */
import { loadSnapshot, snapshotNames, loadSymbolSeries } from "../lib/data";
import { loadSymbolCalls } from "../lib/callsArchive";
import { cachedStats } from "../lib/companyCache";
import { writeFeedOrExit } from "../lib/feedGuard";
import { bootstrapCI } from "../lib/signalGrid";
import {
  buildDataset, cohorts, walkForwardRefit, fitLogit, predictProb, featureVec,
  auc, rankIC, hitRate, calibrationCurve, publishModel, topContributors,
  PRINT_METHOD, FEATURE_NAMES,
  type SymbolInput, type PrintExample, type PrintFeatures, type LinModel,
  type OosResult, type OosBlock, type LivePrediction, type PrintPredictorFile, type PublishedModel,
} from "../lib/printPredictor";

const OUT = "earnings-print-predictor.json";
const UNIVERSE = (process.env.PRINT_PREDICTOR_UNIVERSES || "sp500").split(",")[0].trim() || "sp500";
const MIN_PAIRS = Number(process.env.PRINT_PREDICTOR_MIN_PAIRS || 200);
const nowISO = () => new Date().toISOString();

const FEATS = FEATURE_NAMES as string[];

/** Fit one head on ALL resolved examples (the live model). null when too few / single-class. */
function fitHead(examples: PrintExample[], head: "beat" | "reactUp"): LinModel | null {
  const rows = examples
    .map((e) => ({ x: e.x, y: head === "beat" ? e.y.beat : e.y.reactUp }))
    .filter((r): r is { x: PrintFeatures; y: 0 | 1 } => r.y != null);
  if (rows.length < 30) return null;
  const yv = rows.map((r) => r.y);
  if (yv.every((v) => v === yv[0])) return null;
  return fitLogit(rows.map((r) => featureVec(r.x, FEATS)), yv, FEATS);
}

const mkBlock = (o: OosResult, thresh: number): OosBlock => {
  const cal = calibrationCurve(o.probs, o.labels);
  const hr = hitRate(o.probs, o.labels, thresh);
  return {
    auc: auc(o.probs, o.labels), hit: hr.hit, balanced: hr.balanced,
    brier: cal.brier, reliability: cal.reliability, calibration: cal.bins,
    nOOS: o.nOOS, cohorts: o.nCohorts,
  };
};

const EMPTY_MODEL: PublishedModel = { oddsRatios: [], nTrain: 0, posRate: 0, l2: 1 };

async function main() {
  const snap = await loadSnapshot(UNIVERSE);
  let names: { symbol: string; name: string }[];
  try {
    names = snapshotNames(snap, UNIVERSE); // throws an operator-actionable "hydrate from R2 first" on a stub
  } catch (e) {
    console.error(`print-predictor: ${String((e as Error)?.message || e)}`);
    process.exit(1);
    return;
  }
  const meta = new Map((snap?.stocks || []).map((s) => [s.symbol, s]));

  // Gather per-symbol inputs — all LOCAL reads (archive, company cache, price series).
  const perSymbol: SymbolInput[] = [];
  for (const { symbol } of names) {
    const recs = (await loadSymbolCalls(symbol)).filter((r) => r.digest);
    if (recs.length < 2) continue; // need a pair to label
    const stats = await cachedStats(symbol).catch(() => null);
    const series = (await loadSymbolSeries(symbol))?.daily;
    if (!series?.length) continue;
    const row = meta.get(symbol);
    perSymbol.push({ sym: symbol, sector: row?.sector ?? null, marketCap: row?.marketCap ?? null, recs, surprises: stats?.surprises, daily: series });
  }

  const { examples, live, baseRates } = buildDataset(perSymbol);
  const nBeat = examples.filter((e) => e.y.beat != null).length;
  const nReact = examples.filter((e) => e.y.reactUp != null).length;
  console.log(`print-predictor: ${examples.length} pairs (${nBeat} beat, ${nReact} reaction) · ${live.length} live · beat base ${baseRates.beat} · up base ${baseRates.up}`);
  if (nBeat < MIN_PAIRS && nReact < MIN_PAIRS) {
    console.error(`print-predictor: too few labeled pairs (<${MIN_PAIRS}) — the digested archive is still thin; keeping the prior file (degrade to STALE, never ship an untrained model).`);
    process.exit(1);
    return;
  }

  // PRIMARY: expanding-window walk-forward OOS (refit per cohort, TRAIN-ONLY — no lookahead).
  const coh = cohorts(examples);
  const beatOOS = walkForwardRefit(examples, coh, "beat");
  const reacOOS = walkForwardRefit(examples, coh, "reactUp");
  const oosBeat = mkBlock(beatOOS, baseRates.beat ?? 0.5); // hit at the base rate, not 0.5 (imbalanced)
  const edge = reacOOS.perCohortEdge.length
    ? +(reacOOS.perCohortEdge.reduce((a, b) => a + b, 0) / reacOOS.perCohortEdge.length).toFixed(3)
    : null;
  const oosReac: OosBlock = {
    ...mkBlock(reacOOS, 0.5),
    rankIC: rankIC(reacOOS.probs, reacOOS.move),
    rankICCI: bootstrapCI(reacOOS.perCohortIC),
    longShortEdge: edge,
    edgeCI: bootstrapCI(reacOOS.perCohortEdge),
  };

  // LIVE model: refit on all resolved examples, score the forward (unlabeled) points.
  const mBeat = fitHead(examples, "beat");
  const mReac = fitHead(examples, "reactUp");
  const conf = (m: LinModel | null): "high" | "medium" | "low" =>
    !m ? "low" : m.nTrain >= 400 ? "high" : m.nTrain >= 150 ? "medium" : "low";
  const livePreds: LivePrediction[] = live
    .map((p) => {
      const s = meta.get(p.symbol);
      return {
        symbol: p.symbol, name: s?.name || p.symbol, sector: p.sector, callDate: p.callDate, fiscalPeriod: p.fiscalPeriod,
        predBeatProb: mBeat ? +predictProb(mBeat, p.x).toFixed(4) : null,
        predReactUpProb: mReac ? +predictProb(mReac, p.x).toFixed(4) : null,
        topContributors: mReac ? topContributors(mReac, p.x, 3) : mBeat ? topContributors(mBeat, p.x, 3) : [],
        confidence: conf(mReac || mBeat),
      };
    })
    .sort((a, b) => (b.predReactUpProb ?? 0) - (a.predReactUpProb ?? 0));

  const trainedThrough = examples.reduce((m, e) => (e.labelDate > m ? e.labelDate : m), "");
  const data: PrintPredictorFile = {
    generatedAt: nowISO(), universe: UNIVERSE, trainedThrough: trainedThrough || null,
    baseRates: { beat: baseRates.beat, up: baseRates.up },
    models: { beatMiss: mBeat ? publishModel(mBeat) : EMPTY_MODEL, reaction: mReac ? publishModel(mReac) : EMPTY_MODEL },
    // The secondary "would tuning have helped?" variant-selection layer (signalGrid.walkForward) needs deeper
    // cohort history to be meaningful — deferred to phase 2; the shipped model stays fixed and simple.
    oos: { beatMiss: oosBeat, reaction: oosReac, walkForward: null, verdict: "Variant selection deferred until cohort depth supports it; the shipped model is fixed and simple." },
    live: livePreds, method: PRINT_METHOD,
  };
  await writeFeedOrExit(OUT, data); // no minCount floor (forward-log precedent) → always writes
  console.log(`print-predictor: wrote ${livePreds.length} live · beat AUC ${oosBeat.auc} (n=${oosBeat.nOOS}) · reaction AUC ${oosReac.auc} rank-IC ${oosReac.rankIC} (n=${oosReac.nOOS})`);
}

main().catch((e) => { console.error("print-predictor:", String((e as Error)?.message || e)); process.exit(1); });
