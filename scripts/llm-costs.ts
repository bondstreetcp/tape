/**
 * Print the LLM cost breakdown from data/llm-usage.json (written by lib/llmUsage.ts) — by job and by
 * model, sorted by estimated $, plus totals and a 30-day run-rate. Read-only, no LLM calls. So we can
 * see WHERE the bill goes before optimizing. estUsd is a BALLPARK (lib/llmUsage.ts PRICES); token
 * counts are exact. Run: npm run llm-costs
 */
import { readFileSync } from "fs";
import { join } from "path";

interface Bucket { calls: number; inTok: number; outTok: number; estUsd: number }
interface UsageFile {
  since: string; updatedAt: string; totals: Bucket;
  byModel: Record<string, Bucket>; byJob: Record<string, Bucket>; byDay: Record<string, Bucket>;
}

const FILE = join(process.cwd(), "data", "llm-usage.json");
let f: UsageFile;
try {
  f = JSON.parse(readFileSync(FILE, "utf8")) as UsageFile;
} catch {
  console.error(`llm-costs: no ${FILE} yet — it's written on process exit after LLM jobs run. Nothing to report.`);
  process.exit(0);
}

const obsDays = Object.keys(f.byDay || {}).length || 1;
const perMo = (f.totals.estUsd / obsDays) * 30;
const usd = (n: number) => `$${n.toFixed(2)}`;
const tok = (n: number) => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : `${(n / 1e3).toFixed(0)}k`);
const share = (x: number) => (f.totals.estUsd ? `${((x / f.totals.estUsd) * 100).toFixed(0)}%` : "—");

function table(title: string, rows: Record<string, Bucket>): void {
  const sorted = Object.entries(rows || {}).sort((a, b) => b[1].estUsd - a[1].estUsd);
  if (!sorted.length) return;
  const w = Math.max(10, ...sorted.map(([k]) => k.length));
  console.log(`\n=== ${title} (by est $) ===`);
  for (const [k, b] of sorted) {
    console.log(
      `  ${k.padEnd(w)}  ${usd(b.estUsd).padStart(9)}  ${share(b.estUsd).padStart(4)}  ${String(b.calls).padStart(6)} calls  ${tok(b.inTok).padStart(7)} in / ${tok(b.outTok).padStart(6)} out`,
    );
  }
}

console.log(`LLM usage since ${f.since?.slice(0, 10) ?? "?"} — ${obsDays} day(s) observed`);
console.log(`TOTAL ${usd(f.totals.estUsd)} (${tok(f.totals.inTok)} in / ${tok(f.totals.outTok)} out) → ~${usd(perMo)}/mo all-time avg`);
// Recent-window rate — the all-time average can be inflated by a since-superseded config (e.g. a pricier
// PRO_MODEL before a model switch), so the last 7 observed days is the truer CURRENT run-rate.
const recentDays = Object.keys(f.byDay || {}).sort().slice(-7);
if (recentDays.length) {
  const rb = recentDays.reduce((a, d) => a + (f.byDay[d]?.estUsd || 0), 0);
  console.log(`RECENT ${recentDays.length}d: ${usd(rb)} → ~${usd((rb / recentDays.length) * 30)}/mo (current-config rate; ${recentDays[0]}…${recentDays[recentDays.length - 1]})`);
}
console.log("(estUsd is a ballpark from lib/llmUsage.ts PRICES — edit to match your dashboards; token counts are exact)");
table("By job", f.byJob);
table("By model", f.byModel);
