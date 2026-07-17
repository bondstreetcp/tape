import { test } from "node:test";
import assert from "node:assert/strict";
import {
  cartesian, paramLabel, mulberry32, bootstrapCI, walkForward, verdictFor, runGrid,
  FAMILIES, CELLS_PER_UNIVERSE, GRID_METHOD,
} from "../lib/signalGrid";

const approx = (a: number, b: number, tol = 0.01) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

// Same deterministic synthetic market as the backtest tests: a trending cohort + a flat cohort.
const DAY = 86_400_000;
const START = Date.UTC(2020, 0, 6);
function mkSeries(n: number, ret: (i: number) => number): [number, number][] {
  const out: [number, number][] = [];
  let p = 100, t = START;
  while (out.length < n) {
    const d = new Date(t).getUTCDay();
    if (d !== 0 && d !== 6) { p *= Math.exp(ret(out.length)); out.push([t, p]); }
    t += DAY;
  }
  return out;
}
function market(): Map<string, [number, number][]> {
  const m = new Map<string, [number, number][]>();
  const N = 700;
  for (let x = 0; x < 20; x++) m.set(`TREND${x}`, mkSeries(N, () => 0.0012 + 0.0003 * (x % 5)));
  for (let x = 0; x < 40; x++) m.set(`FLAT${x}`, mkSeries(N, (i) => 0.0004 * Math.sin(i / 3 + x)));
  return m;
}

// ── grid construction ────────────────────────────────────────────────────────────────────────
test("cartesian: deterministic product; CELLS_PER_UNIVERSE matches the declared sweeps", () => {
  assert.deepEqual(cartesian({ topN: [10, 25] }), [{ topN: 10 }, { topN: 25 }]);
  assert.deepEqual(cartesian({ a: [1, 2], b: [3, 4] }), [{ a: 1, b: 3 }, { a: 1, b: 4 }, { a: 2, b: 3 }, { a: 2, b: 4 }]);
  assert.equal(cartesian({}).length, 1); // no params → one cell
  assert.equal(paramLabel({ thresh: 30, topN: 40 }), "thresh=30 topN=40");
  assert.equal(CELLS_PER_UNIVERSE, FAMILIES.reduce((n, f) => n + cartesian(f.sweep).length, 0));
  assert.equal(CELLS_PER_UNIVERSE, 18); // 3 leaders + 6 breakout + 3 momentum + 6 rsi
});

test("every family's shipped default is actually one of its grid cells (a real status-quo baseline)", () => {
  for (const f of FAMILIES) {
    const labels = cartesian(f.sweep).map(paramLabel);
    assert.ok(labels.includes(paramLabel(f.def)), `${f.key}: default ${paramLabel(f.def)} must be in the sweep [${labels.join(", ")}]`);
  }
});

// ── deterministic bootstrap ──────────────────────────────────────────────────────────────────
test("mulberry32 is deterministic per seed and differs across seeds", () => {
  const a = mulberry32(42), b = mulberry32(42), c = mulberry32(43);
  const seqA = [a(), a(), a()], seqB = [b(), b(), b()], seqC = [c(), c(), c()];
  assert.deepEqual(seqA, seqB, "same seed → identical stream");
  assert.notDeepEqual(seqA, seqC, "different seed → different stream");
  for (const v of seqA) assert.ok(v >= 0 && v < 1, "in [0,1)");
});

test("bootstrapCI: constant series → degenerate CI at the constant; <8 points → null; deterministic", () => {
  assert.deepEqual(bootstrapCI([5, 5, 5, 5, 5, 5, 5, 5]), [5, 5]); // every resample mean is 5
  assert.equal(bootstrapCI([1, 2, 3]), null); // too few rebalances to claim an interval
  const xs = [2, -1, 3, 0.5, -2, 4, 1, 0, 2.5, -0.5, 1.5, 3.5];
  assert.deepEqual(bootstrapCI(xs), bootstrapCI(xs), "seeded → identical run-to-run");
});

test("bootstrapCI: a noise-centred series straddles 0; a strongly positive one does not", () => {
  const noise = [2, -2, 1.5, -1.5, 1, -1, 0.5, -0.5, 2, -2, 1, -1];
  const ci = bootstrapCI(noise)!;
  assert.ok(ci[0] <= 0 && ci[1] >= 0, `noise CI straddles zero (${ci})`);
  const strong = Array.from({ length: 24 }, (_, i) => 5 + (i % 2 ? 0.3 : -0.3));
  const ci2 = bootstrapCI(strong)!;
  assert.ok(ci2[0] > 0, `a consistent +5pp edge has a CI above zero (${ci2})`);
});

// ── walk-forward: THE look-ahead guarantee ───────────────────────────────────────────────────
// Cell A wins early then collapses; cell B is the mirror. A look-ahead-free tuner must select on
// CLOSED trailing data only, so it keeps riding A into the regime break and EATS the losses before
// its window learns to switch. Hand-computed (warmup 12, nReb 30, no calendar → the conservative
// one-rebalance embargo, so the window at decision i is [i-13, i-1)):
//   i=12..19 → window all A-good → pick A → +2 × 8              = +16
//   i=20..23 → window still A-favoured → pick A → −5 × 4        = −20
//   i=24..29 → window now B-favoured → switch to B → +10 × 6    = +60
//   realized n=18, mean = 56/18 = 3.11, switches = 1
// A look-AHEAD implementation would have taken B at i=20 and scored ~10 — this pins that it doesn't.
test("walkForward selects on CLOSED trailing data ONLY — it eats the regime break instead of front-running it", () => {
  const A: number[] = [], B: number[] = [];
  for (let i = 0; i < 30; i++) { A.push(i < 20 ? 2 : -5); B.push(i < 20 ? -2 : 10); }
  const wf = walkForward(new Map([["A", A], ["B", B]]), 30, { warmup: 12 })!;
  assert.ok(wf, "walk-forward produced");
  assert.equal(wf.n, 18);
  approx(wf.edge, 3.11);
  assert.equal(wf.switches, 1);
  assert.ok(wf.edge < 10, "cannot reach the hindsight-best late-regime edge");
});

// THE regression the bare-index tests above are structurally blind to. An edge at rebalance j is a
// FIXED 21-bar forward return, but month-ends sit a VARIABLE 19–23 trading days apart — so when the
// gap is short, edges[i-1] hasn't finished yet at decision time i and must not be scored on. Same
// data, two calendars: the 19-bar-gap month must EMBARGO the tell; the 23-bar-gap month may use it.
// "tell" is flat except for a blowout at index 18 that BAITS the tuner into picking it at i=19 —
// where it promptly loses 50. Whether the tuner can see that bait at i=19 depends ONLY on the
// calendar: index 18's 21-bar window closes at 18*19+21 = 363 > 19*19 = 361 (short months → still
// open → must be embargoed), but at 18*23+21 = 435 <= 19*23 = 437 (long months → closed → fair game).
// Hand-computed (warmup 12, n 30) — the ONLY divergence is the i=19 decision:
//   short: i=12..19 ride "steady" (+1 × 8 = 8), i=20..29 ride "tell" (0 × 10) → 8/18 = +0.44
//   long:  i=12..18 ride "steady" (+1 × 7 = 7), i=19 takes the bait (−50), i=20..29 (0 × 10) → −43/18 = −2.39
test("walkForward is calendar-aware: a short month embargoes the not-yet-closed previous edge", () => {
  const n = 30;
  const tell: (number | null)[] = Array.from({ length: n }, () => 0);
  tell[18] = 100; // the bait — only visible at i=19 if its window has closed
  tell[19] = -50; // the punishment for taking it
  const steady: (number | null)[] = Array.from({ length: n }, () => 1);
  const run = (gap: number) =>
    walkForward(new Map([["tell", tell], ["steady", steady]]), n, {
      warmup: 12, horizonBars: 21, rebalanceDayIdx: Array.from({ length: n }, (_, j) => j * gap),
    })!;

  const shortWf = run(19); // February-like: 19 trading days
  const longWf = run(23);
  assert.ok(shortWf && longWf, "both produced");
  approx(shortWf.edge, 0.44);
  approx(longWf.edge, -2.39);
  assert.ok(shortWf.edge > longWf.edge, "embargoing the un-closed month is what avoids the bait");
  // Identical data, identical warmup — the ONLY input that differs is the calendar. If walkForward
  // ignored it (the pre-fix behaviour), these would be equal.
  assert.notEqual(shortWf.edge, longWf.edge, "the calendar must actually be consulted");
});

test("walkForward: null when there aren't enough rebalances after warmup, and ties break deterministically", () => {
  assert.equal(walkForward(new Map([["A", [1, 2, 3]]]), 3, { warmup: 12 }), null);
  const flat = Array.from({ length: 30 }, () => 1);
  const a = walkForward(new Map([["z", [...flat]], ["a", [...flat]]]), 30, { warmup: 12 })!;
  const b = walkForward(new Map([["a", [...flat]], ["z", [...flat]]]), 30, { warmup: 12 })!;
  assert.deepEqual(a, b, "identical cells in any insertion order → identical result (sorted keys)");
  assert.equal(a.switches, 0);
});

test("walkForward ignores a cell with too thin a trailing record rather than selecting on 1 point", () => {
  const solid = Array.from({ length: 30 }, () => 1);
  const sparse: (number | null)[] = Array.from({ length: 30 }, () => null);
  sparse[10] = 99; // one lucky point — must NOT win selection
  const wf = walkForward(new Map([["solid", solid], ["sparse", sparse]]), 30, { warmup: 12 })!;
  approx(wf.edge, 1); // rode "solid" throughout
});

// The tuner only trades AFTER the warmup, so the baseline must be re-measured over the same
// rebalances. Here the default cell is great during the warmup and mediocre after: comparing against
// its FULL-sample average would understate the default and wrongly credit tuning.
test("walkForward reports the indices it traded, so the default can be scored on the SAME window", () => {
  const A = Array.from({ length: 30 }, (_, i) => (i < 12 ? 20 : 1)); // strong in warmup, mediocre after
  const B = Array.from({ length: 30 }, () => 0.5);
  const wf = walkForward(new Map([["A", A], ["B", B]]), 30, { warmup: 12 })!;
  assert.equal(wf.n, wf.idx.length, "one index per realized edge");
  assert.deepEqual(wf.idx, Array.from({ length: 18 }, (_, k) => k + 12), "traded exactly the post-warmup rebalances");
  approx(wf.edge, 1); // rode A at its mediocre post-warmup level
  const fullSampleDefault = A.reduce((a, b) => a + b, 0) / A.length; // 8.6 — flattered by the warmup
  const sameWindowDefault = wf.idx.map((i) => A[i]).reduce((a, b) => a + b, 0) / wf.idx.length; // 1
  approx(sameWindowDefault, 1);
  assert.ok(fullSampleDefault > sameWindowDefault + 5, "full-sample vs same-window differ a LOT — hence the fix");
});

// The verdict must never quote a number from a window it didn't come from: when the default cell
// can't be scored on the tuner's own rebalances, the honest answer is "can't judge", NOT a
// full-sample substitute smuggled into a sentence that says "over the SAME rebalances".
test("verdictFor refuses to judge when the default has no same-window score (no full-sample fallback)", () => {
  const idx = Array.from({ length: 20 }, (_, i) => i + 12);
  const v = verdictFor(null, 3.0, { edge: 1.8, ci: [0.9, 2.7], n: 20, switches: 2, idx });
  assert.match(v, /Not enough gradeable rebalances/i);
  assert.doesNotMatch(v, /SAME rebalances/i, "must not assert a like-for-like comparison it cannot make");
});

// ── verdict wording ─────────────────────────────────────────────────────────────────────────
test("verdictFor: straddling CI → noise; wf ≤ default → keep default; wf > default → worth considering", () => {
  const idx = Array.from({ length: 20 }, (_, i) => i + 12);
  const noise = verdictFor(1.0, 3.0, { edge: 0.4, ci: [-1.2, 2.0], n: 20, switches: 3, idx });
  assert.match(noise, /noise/i);
  assert.match(noise, /hindsight/i);
  const worse = verdictFor(1.0, 3.0, { edge: 0.6, ci: [0.2, 1.0], n: 20, switches: 3, idx });
  assert.match(worse, /does NOT pay|Keep the default/i);
  assert.match(worse, /SAME|same rebalances/i, "wording makes the like-for-like window explicit");
  const better = verdictFor(0.5, 3.0, { edge: 1.8, ci: [0.9, 2.7], n: 20, switches: 3, idx });
  assert.match(better, /beats the default/i);
  assert.match(verdictFor(null, null, null), /Not enough/i);
});

// ── end-to-end on the synthetic market ──────────────────────────────────────────────────────
test("runGrid: every family sweeps, the default cell is flagged, and momentum still finds the trenders", () => {
  const g = runGrid(market(), "test")!;
  assert.ok(g, "grid produced");
  assert.equal(g.universe, "test");
  assert.equal(g.names, 60);
  assert.equal(g.families.length, FAMILIES.length);
  assert.equal(g.families.reduce((n, f) => n + f.cells.length, 0), CELLS_PER_UNIVERSE);
  for (const f of g.families) {
    assert.equal(f.cells.filter((c) => c.isDefault).length, 1, `${f.key}: exactly one default cell`);
  }
  const mom = g.families.find((f) => f.key === "mom_12_1")!;
  assert.ok(mom.bestEdge != null && mom.bestEdge > 0.5, `momentum's best cell beats the pool (${mom.bestEdge}pp)`);
  assert.ok(mom.defaultEdge != null && mom.defaultEdge > 0.5, `so does its shipped default (${mom.defaultEdge}pp)`);
  // Best-in-hindsight can never be worse than the default — it's a max over cells including it.
  assert.ok(mom.bestEdge >= mom.defaultEdge, "best ≥ default by construction");
  assert.ok(mom.verdict.length > 20, "a plain-English verdict ships with every family");
});

test("runGrid: too little history → null; the method box leads with the walk-forward warning", () => {
  const tiny = new Map([["A", mkSeries(100, () => 0.001)]]);
  assert.equal(runGrid(tiny, "test"), null);
  assert.match(GRID_METHOD[0], /WALK-FORWARD/);
  assert.match(GRID_METHOD[0], /biased upward/);
  assert.ok(GRID_METHOD.some((m) => /[Ss]urvivorship/.test(m)), "inherits the backtest's survivorship caveat");
});
