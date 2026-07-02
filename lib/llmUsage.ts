/**
 * LLM token-usage meter → data/llm-usage.json. Records real prompt/completion tokens from every
 * model call (GLM + Gemini-Pro via OpenRouter's `usage`, native Gemini via `usageMetadata`), keyed
 * by model AND by job (the npm script name, e.g. "refresh-ipo"), and rolls up per calendar day so a
 * few nights of runs give an actual monthly run-rate instead of a guess.
 *
 * Accumulates across runs by MERGING into the on-disk file — so in CI (fresh checkout each run) it
 * must be committed with the nightly data (it is: `git add -A data`). Delete the file to reset.
 * Flush is synchronous on process exit (batch scripts) + best-effort; on a read-only FS (Vercel
 * serverless) the write is a caught no-op, so live-route calls just accumulate in memory there.
 *
 * Estimated USD uses the BALLPARK rates below — edit PRICES to match your provider dashboards; the
 * token counts are exact regardless.
 */
import { readFileSync, writeFileSync } from "fs";
import { join, basename } from "path";

// $ per 1M tokens {in, out}. Matched by substring against the model id; DEFAULT for anything else.
const PRICES: { match: RegExp; in: number; out: number }[] = [
  { match: /glm/i, in: 0.4, out: 1.6 },
  { match: /gemini.*(pro|3\.1)/i, in: 2.0, out: 12.0 },
  { match: /gemini.*flash/i, in: 0.1, out: 0.4 },
  { match: /embedding|embed/i, in: 0.15, out: 0 },
];
const DEFAULT_PRICE = { in: 1.0, out: 4.0 };
const priceFor = (model: string) => PRICES.find((p) => p.match.test(model)) ?? DEFAULT_PRICE;
const usd = (model: string, inTok: number, outTok: number) => {
  const p = priceFor(model);
  return (inTok / 1e6) * p.in + (outTok / 1e6) * p.out;
};

interface Bucket { calls: number; inTok: number; outTok: number; estUsd: number }
interface UsageFile {
  since: string;
  updatedAt: string;
  note: string;
  totals: Bucket;
  byModel: Record<string, Bucket>;
  byJob: Record<string, Bucket>;
  byDay: Record<string, Bucket>;
}

const JOB = process.env.npm_lifecycle_event || (process.argv[1] ? basename(process.argv[1]).replace(/\.[tj]s$/, "") : "server");
const FILE = join(process.cwd(), "data", "llm-usage.json");
const emptyBucket = (): Bucket => ({ calls: 0, inTok: 0, outTok: 0, estUsd: 0 });

// In-memory deltas for THIS process, flushed (merged) on exit.
const pending = { byModel: {} as Record<string, Bucket>, byJob: {} as Record<string, Bucket> };
let dirty = false;
let hooked = false;

function add(b: Record<string, Bucket>, key: string, inTok: number, outTok: number, model: string) {
  const x = (b[key] ??= emptyBucket());
  x.calls += 1;
  x.inTok += inTok;
  x.outTok += outTok;
  x.estUsd += usd(model, inTok, outTok);
}

/** Record one model call's token usage. Safe to call from scripts and server routes. */
export function recordUsage(model: string, inTok = 0, outTok = 0): void {
  if (!model || (typeof process === "undefined")) return;
  const i = Number(inTok) || 0;
  const o = Number(outTok) || 0;
  if (i === 0 && o === 0) return;
  add(pending.byModel, model, i, o, model);
  add(pending.byJob, JOB, i, o, model);
  dirty = true;
  if (!hooked) {
    hooked = true;
    // Sync flush on any exit path (normal, process.exit, uncaught) so a batch never loses its tally.
    process.on("exit", flushSync);
  }
}

function mergeInto(dst: Bucket, src: Bucket) {
  dst.calls += src.calls;
  dst.inTok += src.inTok;
  dst.outTok += src.outTok;
  dst.estUsd += src.estUsd;
}

/** Merge this process's deltas into data/llm-usage.json and print a run summary. Synchronous. */
export function flushSync(): void {
  if (!dirty) return;
  dirty = false;
  try {
    const now = new Date();
    const day = now.toISOString().slice(0, 10);
    let f: UsageFile;
    try {
      f = JSON.parse(readFileSync(FILE, "utf8")) as UsageFile;
    } catch {
      f = { since: now.toISOString(), updatedAt: "", note: "", totals: emptyBucket(), byModel: {}, byJob: {}, byDay: {} };
    }
    f.byModel ??= {}; f.byJob ??= {}; f.byDay ??= {}; f.totals ??= emptyBucket();

    // This run's totals (for the console summary) + merge into the file.
    const run = emptyBucket();
    for (const [model, b] of Object.entries(pending.byModel)) {
      mergeInto((f.byModel[model] ??= emptyBucket()), b);
      mergeInto(f.totals, b);
      mergeInto((f.byDay[day] ??= emptyBucket()), b);
      mergeInto(run, b);
    }
    for (const [job, b] of Object.entries(pending.byJob)) mergeInto((f.byJob[job] ??= emptyBucket()), b);

    // Keep byDay to a rolling ~60-day window.
    const days = Object.keys(f.byDay).sort();
    for (const d of days.slice(0, Math.max(0, days.length - 60))) delete f.byDay[d];

    f.updatedAt = now.toISOString();
    f.note = "Token counts are exact; estUsd is a BALLPARK from lib/llmUsage.ts PRICES (edit to match your dashboards). Delete this file to reset the meter.";
    writeFileSync(FILE, JSON.stringify(f, null, 2));

    // One compact block per process — extrapolate a monthly run-rate from the days observed.
    const obsDays = Object.keys(f.byDay).length || 1;
    const perDay = f.totals.estUsd / obsDays;
    console.log(
      `\n[llm-usage] ${JOB}: ${run.calls} calls · ${(run.inTok / 1e3).toFixed(0)}k in / ${(run.outTok / 1e3).toFixed(0)}k out · ~$${run.estUsd.toFixed(3)} this run` +
        `\n[llm-usage] cumulative ${obsDays}d: $${f.totals.estUsd.toFixed(2)} → ~$${(perDay * 30).toFixed(0)}/mo projected (${(f.totals.inTok / 1e6).toFixed(1)}M in / ${(f.totals.outTok / 1e6).toFixed(1)}M out)`,
    );
  } catch {
    /* read-only FS (Vercel) or write error — usage stays in memory; not fatal */
  }
}
