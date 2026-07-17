/**
 * Signal parameter grid — the nightly build (NAS overnight-compute #5). For each US universe it
 * sweeps every signal's parameters over ~5y of stored daily closes and reports, per family: the
 * shipped DEFAULT, the best cell in HINDSIGHT, and the honest WALK-FORWARD number (param chosen on
 * trailing data only). Bootstrap CIs are seeded, so the board doesn't flicker night to night.
 *
 * Compute-over-owned-data: no network, no LLM — just the stored series. SINGLE-THREADED on purpose,
 * so it uses one core of the DS1621+'s four and leaves the rest to the web container sharing the box.
 * Measured ~10s for all four universes; run-tick caps the step at 45m regardless.
 *
 * GRID_BUDGET_MIN (default 20) is a cooperative BETWEEN-universe yield, not a watchdog: it stops the
 * loop before STARTING a universe past the deadline, but the in-flight one runs to completion, so the
 * true worst case is the budget plus one universe. A universe the budget didn't reach is CARRIED
 * FORWARD from the prior file with its own older `asOf`, so a slow night degrades to STALE
 * per-universe rather than dropping a board. (If the step is ever hard-killed it writes nothing at
 * all — the prior file simply stands, per the "a KILLED step writes NOTHING" doctrine.)
 *
 * Math + the honesty box live in lib/signalGrid (pure, unit-tested).
 */
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot, loadSymbolSeries } from "../lib/data";
import { runGrid, GRID_METHOD, CELLS_PER_UNIVERSE, type SignalGridFile, type StampedGridUniverse } from "../lib/signalGrid";
import { writeFeedGuarded } from "../lib/feedGuard";

const OUT = "signal-grid.json";
const OUT_ABS = path.join(process.cwd(), "data", OUT);
const BUDGET_MIN = Number(process.env.GRID_BUDGET_MIN || 20);
// Broadest last: if the budget bites, we'd rather have lost the most expensive universe than the
// headline one. sp500 is the universe the live record grades against.
const UNIVERSES = (process.env.GRID_UNIVERSES || "sp500,nasdaq100,russell1000,russell3000").split(",").map((s) => s.trim()).filter(Boolean);

async function seriesFor(universe: string): Promise<Map<string, [number, number][]>> {
  const snap = await loadSnapshot(universe);
  const series = new Map<string, [number, number][]>();
  for (const s of snap?.stocks ?? []) {
    const ser = await loadSymbolSeries(s.symbol).catch(() => null);
    const daily = ser?.daily;
    if (Array.isArray(daily) && daily.length >= 320) series.set(s.symbol, daily as [number, number][]);
  }
  return series;
}

async function main() {
  const deadline = Date.now() + BUDGET_MIN * 60_000;
  const now = new Date().toISOString();

  // Prior file → per-universe carry-forward for anything this run can't reach.
  const prior = await fsp.readFile(OUT_ABS, "utf8").then((s) => JSON.parse(s) as SignalGridFile).catch(() => null);
  const priorByU = new Map((prior?.universes ?? []).map((u) => [u.universe, u]));

  const fresh: StampedGridUniverse[] = [];
  for (const u of UNIVERSES) {
    if (Date.now() > deadline) { console.warn(`grid: BUDGET (${BUDGET_MIN}m) spent — ${u} and any after it carry forward from the prior file.`); break; }
    const t0 = Date.now();
    const series = await seriesFor(u);
    if (series.size < 50) { console.warn(`grid: ${u} — only ${series.size} names with ≥320 bars, skipping.`); continue; }
    const g = runGrid(series, u);
    if (!g) { console.warn(`grid: ${u} — not enough aligned history, skipping.`); continue; }
    fresh.push({ ...g, asOf: now });
    const secs = ((Date.now() - t0) / 1000).toFixed(0);
    console.log(`grid: ${u} — ${series.size} names, ${g.rebalances} rebalances, ${CELLS_PER_UNIVERSE} cells in ${secs}s`);
    for (const f of g.families) {
      const wf = f.walkForward;
      console.log(`   ${f.label.padEnd(24)} default ${String(f.defaultEdge ?? "—").padStart(6)}pp · best ${String(f.bestEdge ?? "—").padStart(6)}pp (${f.bestLabel}) · walk-fwd ${wf ? `${wf.edge}pp ci[${wf.ci?.join(", ") ?? "—"}]` : "—"}`);
    }
  }

  // If NOTHING was computed this run, do not republish the prior contents under a fresh timestamp —
  // that would reset the feed's age and make a wholly-dead grid read FRESH forever. Write nothing;
  // the prior file stands and the freshness monitor correctly ages it out to STALE.
  if (!fresh.length) {
    console.error("grid: no universe was computed this run — leaving the prior file untouched so it ages honestly (degrade to STALE, never EMPTY).");
    process.exit(1);
  }

  // Merge: fresh wins; every OTHER universe already in the file carries forward with its own asOf.
  // Iterate the union (not just UNIVERSES) so a narrowed ad-hoc run — e.g.
  // `GRID_UNIVERSES=sp500 npm run refresh-signal-grid` — can't silently delete the other universes'
  // healthy results from the published file.
  const order = [...new Set([...UNIVERSES, ...priorByU.keys()])];
  const merged: StampedGridUniverse[] = [];
  for (const u of order) {
    const f = fresh.find((x) => x.universe === u);
    if (f) merged.push(f);
    else { const p = priorByU.get(u); if (p) { merged.push(p); console.log(`grid: ${u} carried forward (asOf ${p.asOf?.slice(0, 10) ?? "?"})`); } }
  }

  const data: SignalGridFile = { generatedAt: now, cellsPerUniverse: CELLS_PER_UNIVERSE, universes: merged, method: GRID_METHOD };
  const w = await writeFeedGuarded(OUT, data);
  if (!w.written) {
    console.error(`grid: WRITE BLOCKED — ${w.reason}. Built ${merged.length} universes; keeping the prior file.`);
    process.exit(1);
  }
  console.log(`grid: wrote ${merged.length} universes (${fresh.length} fresh) × ${CELLS_PER_UNIVERSE} cells → data/${OUT} [${w.reason}]`);
}

main().catch((e) => { console.error("grid:", String(e?.message || e)); process.exit(1); });
