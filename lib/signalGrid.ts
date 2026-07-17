/**
 * Signal PARAMETER GRID — "does the setting actually matter, or am I fitting noise?" (NAS
 * overnight-compute #5). Pure engine, no I/O.
 *
 * lib/signalBacktest replays FOUR signals at ONE fixed setting each. This sweeps each signal's
 * parameters across a grid, over several universes, and answers the only question that matters once
 * you have a grid: **would tuning the parameter have helped you out-of-sample?**
 *
 * Three numbers per family, and the order matters:
 *  • DEFAULT — the setting the live board actually ships. The status quo.
 *  • BEST — the best cell in hindsight. ALWAYS flattering; with N cells the max is biased upward even
 *    when every cell is pure noise. Never read this as an achievable edge.
 *  • WALK-FORWARD — at each rebalance, pick the param that led over the trailing window, apply it
 *    forward, measure. This is the honest number: it's what an adaptive tuner would actually have
 *    earned. If it doesn't beat DEFAULT, the parameter is noise — say so. The trailing window admits
 *    only rebalances whose forward returns had CLOSED by the decision date (a fixed 21-bar horizon vs
 *    19–23-bar month gaps means the previous month is often still open — see walkForward).
 *
 * Cost shape (the NAS point): the expensive step is the per-name point-in-time state, and it's
 * computed ONCE per rebalance (signalBacktest.statesAt) then reused by every cell — so an 18-cell
 * grid costs barely more than the 4-signal backtest. Single-threaded on purpose: one core of the
 * DS1621+'s four, leaving the rest for the web container it shares the box with.
 *
 * Determinism: the bootstrap uses a SEEDED PRNG, so the same series always yield the same CIs — a
 * board that flickered its confidence intervals nightly would be unreadable.
 */
import {
  BT_HORIZONS, BT_METHOD, type BtHorizonKey, type NameState,
  buildPanel, statesAt, pctRank, median,
} from "./signalBacktest";

export type GridParams = Record<string, number>;

interface Family {
  key: string;
  label: string;
  desc: string;
  sweep: Record<string, number[]>;
  def: GridParams; // the setting the LIVE board ships — the status quo we must beat
  pick: (st: NameState[], p: GridParams) => string[];
}

/** Cartesian product of a param sweep → the family's cells (insertion-ordered, deterministic). */
export function cartesian(sweep: Record<string, number[]>): GridParams[] {
  let out: GridParams[] = [{}];
  for (const [k, vals] of Object.entries(sweep)) {
    const next: GridParams[] = [];
    for (const o of out) for (const v of vals) next.push({ ...o, [k]: v });
    out = next;
  }
  return out;
}

export const paramLabel = (p: GridParams): string =>
  Object.entries(p).map(([k, v]) => `${k}=${v}`).join(" ");

/** The parameterized families. Each `def` MIRRORS the live board's shipped rule, so the DEFAULT column
 *  is a true status-quo baseline (leaders/breakout mirror lib/leaders.ts exactly). */
export const FAMILIES: Family[] = [
  {
    key: "leaders_rs",
    label: "Leaders (RS composite)",
    desc: "Top-N by the Leaders board's 1w/3m/6m/1y return-percentile blend (0.1/0.2/0.3/0.4).",
    sweep: { topN: [10, 25, 50] },
    def: { topN: 25 },
    pick: (st, p) => {
      const p1w = pctRank(st.map((s) => ({ sym: s.sym, v: s.r1w })));
      const p3m = pctRank(st.map((s) => ({ sym: s.sym, v: s.r3m })));
      const p6m = pctRank(st.map((s) => ({ sym: s.sym, v: s.r6m })));
      const p1y = pctRank(st.map((s) => ({ sym: s.sym, v: s.r1y })));
      return st
        .map((s) => ({ sym: s.sym, rs: 0.1 * p1w.get(s.sym)! + 0.2 * p3m.get(s.sym)! + 0.3 * p6m.get(s.sym)! + 0.4 * p1y.get(s.sym)! }))
        .sort((a, b) => b.rs - a.rs)
        .slice(0, p.topN)
        .map((x) => x.sym);
    },
  },
  {
    key: "breakout",
    label: "Breakout tag",
    desc: "Within X% of the 52-week closing high + golden cross + above the 200-day.",
    sweep: { nearHighPct: [1, 3, 5], topN: [20, 40] },
    def: { nearHighPct: 3, topN: 40 },
    pick: (st, p) =>
      st
        .filter((s) => s.pctFromHigh >= -p.nearHighPct && s.goldenCross && s.aboveMa200)
        .sort((a, b) => b.pctFromHigh - a.pctFromHigh)
        .slice(0, p.topN)
        .map((s) => s.sym),
  },
  {
    key: "mom_12_1",
    label: "Momentum 12−1",
    desc: "Top-N by return from 12 months ago to 1 month ago (skips the reversal month).",
    sweep: { topN: [10, 25, 50] },
    def: { topN: 25 },
    pick: (st, p) => [...st].sort((a, b) => b.mom121 - a.mom121).slice(0, p.topN).map((s) => s.sym),
  },
  {
    key: "rsi_oversold",
    label: "Oversold bounce (RSI)",
    desc: "RSI(14) below the threshold, most oversold first.",
    sweep: { thresh: [25, 30, 35], topN: [20, 40] },
    def: { thresh: 30, topN: 40 },
    pick: (st, p) => st.filter((s) => s.rsi14 < p.thresh).sort((a, b) => a.rsi14 - b.rsi14).slice(0, p.topN).map((s) => s.sym),
  },
];

export const CELLS_PER_UNIVERSE = FAMILIES.reduce((n, f) => n + cartesian(f.sweep).length, 0);

// ── deterministic bootstrap ──────────────────────────────────────────────────────────────────────
/** mulberry32 — a tiny seeded PRNG. Math.random would make the CIs flicker run-to-run. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/**
 * Percentile bootstrap CI for the MEAN of `xs`.
 *
 * ⚠ `xs` must be the per-REBALANCE edge series, never pick-level observations: picks inside one
 * rebalance share that month's market move, so resampling them as if independent would report a
 * spuriously tight interval. One rebalance = one ~independent draw.
 */
export function bootstrapCI(xs: number[], resamples = 1000, seed = 0x5eed, alpha = 0.05): [number, number] | null {
  if (xs.length < 8) return null; // too few rebalances to claim an interval
  const rnd = mulberry32(seed);
  const means: number[] = [];
  for (let r = 0; r < resamples; r++) {
    let s = 0;
    for (let i = 0; i < xs.length; i++) s += xs[(rnd() * xs.length) | 0];
    means.push(s / xs.length);
  }
  means.sort((a, b) => a - b);
  const lo = means[Math.floor((alpha / 2) * resamples)];
  const hi = means[Math.min(resamples - 1, Math.floor((1 - alpha / 2) * resamples))];
  return [+lo.toFixed(2), +hi.toFixed(2)];
}

const mean = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

// ── walk-forward param selection ─────────────────────────────────────────────────────────────────
export interface WalkForward {
  edge: number;
  ci: [number, number] | null;
  n: number;
  switches: number;
  /** The rebalance INDICES the tuner actually traded (post-warmup, gradeable). The baseline MUST be
   *  re-measured over exactly these — comparing a post-warmup adaptive result against a full-sample
   *  default is apples-to-oranges and silently flatters (or buries) tuning. */
  idx: number[];
}

export interface WalkForwardOpts {
  warmup?: number;
  /** Each rebalance's position in the TRADING-DAY calendar (its index in panel.days).
   *
   *  ⚠ This is what makes the no-leak guarantee real, and omitting it is not safe-by-default. An edge
   *  at rebalance j is a FIXED `horizonBars`-bar forward return, but month-end rebalances are a
   *  VARIABLE 19–23 trading days apart. So edges[i-1] frequently does not finish until AFTER
   *  rebalance i (February always has 19–20 trading days; ~36% of month gaps are under 21 bars) —
   *  scoring on it would peek at returns that hadn't happened yet at the decision date. With the
   *  calendar we admit an edge only once its window has actually closed; without one we fall back to
   *  a conservative one-rebalance embargo. */
  rebalanceDayIdx?: number[];
  /** Bars in the horizon the edges are measured over (m1 = 21). */
  horizonBars?: number;
}

/** The newest rebalance index whose forward window has CLOSED by decision-time `i` (exclusive end).
 *  With a calendar this is exact; without one we embargo the most recent rebalance, which is the
 *  conservative answer for any horizon ≤ the typical month gap. */
function admissibleEnd(i: number, dayIdx: number[] | null, horizonBars: number): number {
  if (!dayIdx) return Math.max(0, i - 1);
  let end = i;
  while (end > 0 && dayIdx[end - 1] + horizonBars > dayIdx[i]) end--; // drop windows still open at i
  return end;
}

/**
 * At each rebalance i ≥ warmup, score every cell on its mean edge over the most recent `warmup`
 * rebalances whose forward windows had ALREADY CLOSED by i (see rebalanceDayIdx — this is stricter
 * than "index < i"), then realize the chosen cell's edge AT i. Ties break on cell key, so the result
 * is deterministic. `edges` maps cellKey → per-rebalance edge (null where a cell had no gradeable
 * picks). Nothing unknowable at time i can influence the choice made at i.
 */
export function walkForward(edges: Map<string, (number | null)[]>, nReb: number, opts: WalkForwardOpts = {}): WalkForward | null {
  const { warmup = 12, rebalanceDayIdx = null, horizonBars = 21 } = opts;
  const keys = [...edges.keys()].sort();
  if (!keys.length || nReb <= warmup) return null;
  const minHist = Math.max(4, Math.floor(warmup / 2));
  const realized: number[] = [];
  const idx: number[] = [];
  let switches = 0;
  let prev: string | null = null;
  for (let i = warmup; i < nReb; i++) {
    const end = admissibleEnd(i, rebalanceDayIdx, horizonBars);
    const start = Math.max(0, end - warmup);
    if (end - start < minHist) continue; // not enough CLOSED history to select on yet
    let bestKey: string | null = null;
    let bestScore = -Infinity;
    for (const k of keys) {
      const hist = edges.get(k)!.slice(start, end).filter((x): x is number => x != null);
      if (hist.length < minHist) continue; // too thin a track record to select on
      const sc = mean(hist);
      if (sc > bestScore) { bestScore = sc; bestKey = k; } // keys pre-sorted → deterministic ties
    }
    if (!bestKey) continue;
    if (prev && bestKey !== prev) switches++;
    prev = bestKey;
    const e = edges.get(bestKey)![i];
    if (e != null) { realized.push(e); idx.push(i); }
  }
  if (realized.length < 8) return null;
  return { edge: +mean(realized).toFixed(2), ci: bootstrapCI(realized), n: realized.length, switches, idx };
}

// ── output types ─────────────────────────────────────────────────────────────────────────────────
export interface GridCellStat {
  params: GridParams;
  paramLabel: string;
  isDefault: boolean;
  avgPicks: number;
  n: number; // rebalances contributing at m1
  edge: Record<BtHorizonKey, number | null>; // mean per-rebalance edge, pp
  ci: [number, number] | null; // bootstrap 95% CI on the m1 mean edge
  hit: number | null; // m1 pick-level share beating the pool median
}

export interface GridFamilyStat {
  key: string;
  label: string;
  desc: string;
  cells: GridCellStat[];
  defaultLabel: string;
  defaultEdge: number | null; // over ALL rebalances — comparable to bestEdge, NOT to walkForward
  /** The shipped default measured over EXACTLY the rebalances the walk-forward traded. This — not
   *  defaultEdge — is the fair baseline for walkForward.edge (same window, same market regimes). */
  defaultEdgeWf: number | null;
  bestLabel: string;
  bestEdge: number | null;
  spread: number | null; // best − worst m1 edge: how much the knob moves the result at all
  walkForward: WalkForward | null;
  verdict: string; // plain-English read — the thing to actually act on
}

export interface GridUniverse {
  universe: string;
  rebalances: number;
  names: number;
  start: string;
  end: string;
  families: GridFamilyStat[];
}

/** A universe as PUBLISHED: stamped with when it was actually computed. The refresh script carries a
 *  universe forward from the prior file when a budget-truncated night didn't reach it, so `asOf` is
 *  the honest per-universe freshness — the file's `generatedAt` only says when the run happened. */
export type StampedGridUniverse = GridUniverse & { asOf: string };

export interface SignalGridFile {
  generatedAt: string;
  cellsPerUniverse: number;
  universes: StampedGridUniverse[];
  method: string[];
}

export const GRID_METHOD: string[] = [
  "Read the WALK-FORWARD row, not the best cell. At each rebalance the parameter is chosen using only the most recent 12 rebalances whose own forward returns had ALREADY FINISHED by that date, then applied forward — that is what an adaptive tuner would actually have earned. (Month-ends sit 19–23 trading days apart while the horizon is a fixed 21, so the previous month's result often isn't in yet; those unfinished months are excluded rather than peeked at.) The BEST column is the best setting in hindsight and is biased upward: pick the max of N cells and you get a flattering number even when every cell is pure noise.",
  "If walk-forward does not beat the default, the parameter is noise — keep the shipped setting. That is a real result, not a failure.",
  "The walk-forward is compared against the default measured over EXACTLY the rebalances the tuner traded (it only starts after a 12-rebalance warmup). Scoring an adaptive result that skips the first year against a default that includes it would compare two different windows — and two different market regimes.",
  "Confidence intervals are a 1,000-resample percentile bootstrap of the mean PER-REBALANCE edge (picks inside one rebalance share that month's market move, so resampling picks as if independent would fake a tight interval). The PRNG is seeded, so the intervals are identical run-to-run. A CI straddling 0 means the edge is indistinguishable from noise.",
  "The grid reuses the headline backtest's engine exactly — same point-in-time state, same month-end calendar, same equal-weight pool benchmark — so every caveat below applies here too.",
  ...BT_METHOD,
];

// ── engine ───────────────────────────────────────────────────────────────────────────────────────
/** Run the full parameter grid for one universe. Pure + deterministic. */
export function runGrid(series: Map<string, [number, number][]>, universe: string, warmup = 12): GridUniverse | null {
  const panel = buildPanel(series);
  if (!panel) return null;
  const { rebalances } = panel;
  // Where each rebalance sits in the trading-day calendar — walkForward needs this to know whether an
  // edge's forward window had actually closed by the next decision date (month gaps run 19–23 bars
  // against a fixed 21-bar horizon).
  const dayPos = new Map(panel.days.map((t, k) => [t, k]));
  const rebalanceDayIdx = rebalances.map((t) => dayPos.get(t) ?? -1);
  const M1_BARS = BT_HORIZONS.find((h) => h.key === "m1")!.bars;

  // cellKey → per-rebalance edge per horizon (null = no gradeable picks at that rebalance)
  const cells = FAMILIES.flatMap((f) => cartesian(f.sweep).map((p) => ({ fam: f, p, key: `${f.key}|${paramLabel(p)}` })));
  const edgeSeries = new Map<string, Record<BtHorizonKey, (number | null)[]>>();
  const picksTotal = new Map<string, number>();
  const picksRebs = new Map<string, number>();
  const hitObs = new Map<string, { beat: number; n: number }>();
  for (const c of cells) {
    edgeSeries.set(c.key, { w1: [], m1: [], m3: [] });
    picksTotal.set(c.key, 0);
    picksRebs.set(c.key, 0);
    hitObs.set(c.key, { beat: 0, n: 0 });
  }
  const everEligible = new Set<string>();
  let usableRebs = 0;

  for (const t of rebalances) {
    // THE expensive step — once per rebalance, shared by every cell below.
    const states = statesAt(panel, t);
    for (const s of states) everEligible.add(s.sym);
    if (states.length < 50) {
      for (const c of cells) for (const h of BT_HORIZONS) edgeSeries.get(c.key)![h.key].push(null);
      continue;
    }
    usableRebs++;
    const bySym = new Map(states.map((s) => [s.sym, s]));
    const pool: Record<BtHorizonKey, { avg: number; med: number } | null> = { w1: null, m1: null, m3: null };
    for (const h of BT_HORIZONS) {
      const xs = states.map((s) => s.fwd[h.key]).filter((x): x is number => x != null);
      if (xs.length >= 50) pool[h.key] = { avg: mean(xs), med: median(xs) };
    }

    for (const c of cells) {
      const picks = c.fam.pick(states, c.p);
      if (picks.length) { picksTotal.set(c.key, picksTotal.get(c.key)! + picks.length); picksRebs.set(c.key, picksRebs.get(c.key)! + 1); }
      for (const h of BT_HORIZONS) {
        const p = pool[h.key];
        const fwds = p && picks.length ? picks.map((s) => bySym.get(s)!.fwd[h.key]).filter((x): x is number => x != null) : [];
        if (!p || !fwds.length) { edgeSeries.get(c.key)![h.key].push(null); continue; }
        edgeSeries.get(c.key)![h.key].push(mean(fwds) - p.avg);
        if (h.key === "m1") {
          const ho = hitObs.get(c.key)!;
          for (const f of fwds) { ho.n++; if (f > p.med) ho.beat++; }
        }
      }
    }
  }
  if (usableRebs < 12) return null;

  const families: GridFamilyStat[] = FAMILIES.map((f) => {
    const fCells = cells.filter((c) => c.fam.key === f.key);
    const stats: GridCellStat[] = fCells.map((c) => {
      const es = edgeSeries.get(c.key)!;
      const m1 = es.m1.filter((x): x is number => x != null);
      const ho = hitObs.get(c.key)!;
      const edge = {} as Record<BtHorizonKey, number | null>;
      for (const h of BT_HORIZONS) {
        const xs = es[h.key].filter((x): x is number => x != null);
        edge[h.key] = xs.length >= 8 ? +mean(xs).toFixed(2) : null;
      }
      return {
        params: c.p,
        paramLabel: paramLabel(c.p),
        isDefault: paramLabel(c.p) === paramLabel(f.def),
        avgPicks: picksRebs.get(c.key)! ? +(picksTotal.get(c.key)! / picksRebs.get(c.key)!).toFixed(1) : 0,
        n: m1.length,
        edge,
        ci: bootstrapCI(m1),
        hit: ho.n ? +(ho.beat / ho.n).toFixed(3) : null,
      };
    });

    const scored = stats.filter((s) => s.edge.m1 != null);
    const best = scored.length ? scored.reduce((a, b) => (b.edge.m1! > a.edge.m1! ? b : a)) : null;
    const worst = scored.length ? scored.reduce((a, b) => (b.edge.m1! < a.edge.m1! ? b : a)) : null;
    const def = stats.find((s) => s.isDefault) ?? null;
    const wf = walkForward(new Map(fCells.map((c) => [c.key, edgeSeries.get(c.key)!.m1])), rebalances.length, { warmup, rebalanceDayIdx, horizonBars: M1_BARS });

    // Re-measure the shipped default over EXACTLY the walk-forward's traded rebalances — the tuner
    // only starts after the warmup, so scoring it against the default's full-sample number would
    // compare two different windows (and two different market regimes).
    const defCell = fCells.find((c) => paramLabel(c.p) === paramLabel(f.def));
    let defaultEdgeWf: number | null = null;
    if (wf && defCell) {
      const series = edgeSeries.get(defCell.key)!.m1;
      const sameWindow = wf.idx.map((i) => series[i]).filter((x): x is number => x != null);
      if (sameWindow.length >= 8) defaultEdgeWf = +mean(sameWindow).toFixed(2);
    }

    return {
      key: f.key,
      label: f.label,
      desc: f.desc,
      cells: stats,
      defaultLabel: paramLabel(f.def),
      defaultEdge: def?.edge.m1 ?? null,
      defaultEdgeWf,
      bestLabel: best?.paramLabel ?? "—",
      bestEdge: best?.edge.m1 ?? null,
      spread: best && worst ? +(best.edge.m1! - worst.edge.m1!).toFixed(2) : null,
      walkForward: wf,
      // NO fallback to the full-sample defaultEdge: both verdict branches assert "over the SAME
      // rebalances", so substituting a different-window number would print the exact apples-to-oranges
      // claim defaultEdgeWf exists to eliminate. Null → verdictFor says it can't judge, which is true.
      verdict: verdictFor(defaultEdgeWf, best?.edge.m1 ?? null, wf),
    };
  });

  return {
    universe,
    rebalances: rebalances.length,
    names: everEligible.size,
    start: new Date(rebalances[0]).toISOString().slice(0, 10),
    end: new Date(rebalances[rebalances.length - 1]).toISOString().slice(0, 10),
    families,
  };
}

/** The plain-English read. Deliberately biased toward "it's noise" — that is the base rate for
 *  parameter tuning on 5 years of monthly rebalances, and the expensive mistake is believing the
 *  hindsight-best number.
 *
 *  `defaultEdgeSameWindow` MUST be the default measured over the walk-forward's OWN traded rebalances
 *  (GridFamilyStat.defaultEdgeWf), never the full-sample defaultEdge. */
export function verdictFor(defaultEdgeSameWindow: number | null, bestEdge: number | null, wf: WalkForward | null): string {
  if (defaultEdgeSameWindow == null || bestEdge == null) return "Not enough gradeable rebalances to judge this family.";
  if (!wf) return `No walk-forward result (too few rebalances after warmup) — treat the ${bestEdge.toFixed(2)}pp best cell as hindsight only, and keep the shipped setting.`;
  const straddlesZero = wf.ci ? wf.ci[0] <= 0 && wf.ci[1] >= 0 : true;
  if (straddlesZero) return `Tuning is noise: walk-forward earns ${wf.edge.toFixed(2)}pp but its CI straddles zero. Keep the shipped setting; the ${bestEdge.toFixed(2)}pp "best" cell is hindsight.`;
  if (wf.edge <= defaultEdgeSameWindow) return `Tuning does NOT pay: over the same rebalances the tuner traded, it earns ${wf.edge.toFixed(2)}pp vs the shipped default's ${defaultEdgeSameWindow.toFixed(2)}pp. Keep the default — the knob is fitting noise.`;
  return `Tuning beats the default out-of-sample: ${wf.edge.toFixed(2)}pp vs the default's ${defaultEdgeSameWindow.toFixed(2)}pp over the SAME rebalances (it switched setting ${wf.switches}×). Worth considering — the best-in-hindsight ${bestEdge.toFixed(2)}pp is still not achievable.`;
}
