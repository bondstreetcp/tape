/**
 * Signal-efficacy BACKTEST (client-safe types + pure engine, no I/O). The live Signal Track Record
 * (lib/signalLog) grades boards forward from the day logging started; this reconstructs the subset of
 * signals whose membership is POINT-IN-TIME recomputable from the stored daily price series — price
 * and moving-average rules only — and grades them over the full ~5y of history in one pass.
 *
 * Honesty box (rendered with the results — keep in sync with METHOD below):
 *  • Survivorship: membership is TODAY's S&P 500 — names that crashed out of the index before today
 *    never get picked, which flatters every signal. Treat edges as upper bounds.
 *  • Only price-reconstructible signals qualify. Boards built on options/positioning/estimates/filings
 *    state we didn't store historically (Confluence, Squeeze, Coiled Springs…) stay forward-only in
 *    the live record — reconstructing them would silently look ahead.
 *  • Close-only series (52w-high uses the highest CLOSE), no transaction costs, monthly rebalance at
 *    the close, horizons in TRADING days (5/21/63 ≈ the live record's 1w/1m/3m).
 *  • Benchmark = the equal-weight average of the SAME eligible pool that day, so "edge" is pure
 *    selection skill, not market timing. Hit rate = share of picks beating that day's pool MEDIAN.
 *  • Names showing a >0.5 one-day |log return| in the trailing year are excluded at that rebalance
 *    (split artifact / data fault guard — the vol-cone doctrine).
 */

export type BtHorizonKey = "w1" | "m1" | "m3";
export const BT_HORIZONS: { key: BtHorizonKey; bars: number; label: string }[] = [
  { key: "w1", bars: 5, label: "1w" },
  { key: "m1", bars: 21, label: "1m" },
  { key: "m3", bars: 63, label: "3m" },
];

export interface BtHorizonStat {
  avg: number; // mean pick forward return (%, pick-level)
  poolAvg: number; // mean pool forward return (%, same dates, equal-weight)
  edge: number; // mean of per-rebalance (pickAvg − poolAvg), pp
  hit: number; // share of picks beating that rebalance's pool median (0–1)
  n: number; // pick-horizon observations
}

export interface BtSignal {
  key: string;
  label: string;
  desc: string; // one-line rule, shown in the UI
  avgPicks: number;
  horizons: Record<BtHorizonKey, BtHorizonStat | null>;
  curve: { t: number; cum: number }[]; // cumulative 1m edge (pp, non-compounded) per rebalance
}

export interface BacktestFile {
  generatedAt: string;
  universe: string;
  start: string; // first rebalance ISO date
  end: string; // last rebalance ISO date
  rebalances: number;
  names: number; // series that qualified at least once
  signals: BtSignal[];
  method: string[]; // the honesty box, rendered verbatim
}

export const BT_METHOD: string[] = [
  "Survivorship bias: membership is today's S&P 500 applied historically — names that left the index never get picked, which flatters every signal. Read edges as upper bounds.",
  "Only price-reconstructible signals are backtested. Boards that depend on options, positioning, estimates or filings state we didn't store historically (Confluence, Squeeze, Coiled Springs…) stay forward-only in the live record — reconstructing them would look ahead.",
  "Close-only daily series (the 52-week high is the highest close), no transaction costs, monthly rebalance at the close, horizons in trading days (5/21/63 ≈ 1w/1m/3m).",
  "Benchmark is the equal-weight average of the same eligible pool on the same day, so edge measures stock SELECTION, not market timing. Hit rate is the share of picks beating that day's pool median.",
  "A name with a >0.5 one-day |log return| in the trailing year is excluded at that rebalance (split-artifact guard).",
];

// ── per-name state at a rebalance ──────────────────────────────────────────────────────────────
/** Exported so lib/signalGrid can reuse the IDENTICAL state definition — the grid must never drift
 *  from what the headline backtest measures. */
export interface NameState {
  sym: string;
  r1w: number; r3m: number; r6m: number; r1y: number;
  mom121: number; // 12-1 momentum: t−252 → t−21
  pctFromHigh: number; // % below trailing-252 closing high (≤ 0)
  aboveMa200: boolean;
  goldenCross: boolean;
  rsi14: number;
  fwd: Record<BtHorizonKey, number | null>; // forward %, null when the series ends first
}

const ret = (c: number[], i: number, n: number) => c[i] / c[i - n] - 1;

function rsi14At(c: number[], i: number): number {
  let up = 0, dn = 0;
  for (let j = i - 13; j <= i; j++) {
    const d = c[j] - c[j - 1];
    if (d >= 0) up += d; else dn -= d;
  }
  if (dn <= 0) return 100;
  const rs = up / dn;
  return 100 - 100 / (1 + rs);
}

export function stateAt(sym: string, c: number[], i: number): NameState | null {
  if (i < 260) return null;
  // split-artifact guard over the trailing year
  for (let j = i - 251; j <= i; j++) if (Math.abs(Math.log(c[j] / c[j - 1])) > 0.5) return null;
  let ma50 = 0, ma200 = 0, hi = 0;
  for (let j = i - 49; j <= i; j++) ma50 += c[j];
  for (let j = i - 199; j <= i; j++) ma200 += c[j];
  for (let j = i - 251; j <= i; j++) hi = Math.max(hi, c[j]);
  ma50 /= 50; ma200 /= 200;
  const fwd: NameState["fwd"] = { w1: null, m1: null, m3: null };
  for (const h of BT_HORIZONS) if (i + h.bars < c.length) fwd[h.key] = ret(c, i + h.bars, h.bars) * 100;
  return {
    sym,
    r1w: ret(c, i, 5), r3m: ret(c, i, 63), r6m: ret(c, i, 126), r1y: ret(c, i, 252),
    mom121: c[i - 21] / c[i - 252] - 1,
    pctFromHigh: (c[i] / hi - 1) * 100,
    aboveMa200: c[i] >= ma200,
    goldenCross: ma50 > ma200,
    rsi14: rsi14At(c, i),
    fwd,
  };
}

// Percentile-rank helper (higher value → higher pct), mirroring lib/leaders.ts pctRanks.
export function pctRank(vals: { sym: string; v: number }[]): Map<string, number> {
  const sorted = [...vals].sort((a, b) => a.v - b.v);
  const n = sorted.length;
  const m = new Map<string, number>();
  sorted.forEach((x, i) => m.set(x.sym, n > 1 ? (i / (n - 1)) * 100 : 50));
  return m;
}

// ── signal definitions ─────────────────────────────────────────────────────────────────────────
// pick(states) → the signal's membership that day, strongest first. Mirrors the live boards' rules
// where one exists (leaders/breakout mirror lib/leaders.ts weights and thresholds exactly).
const SIGNALS: { key: string; label: string; desc: string; pick: (st: NameState[]) => string[] }[] = [
  {
    key: "leaders_rs",
    label: "Leaders (RS composite)",
    desc: "Top 25 by the Leaders board's IBD-style blend of 1w/3m/6m/1y return percentiles (0.1/0.2/0.3/0.4).",
    pick: (st) => {
      const p1w = pctRank(st.map((s) => ({ sym: s.sym, v: s.r1w })));
      const p3m = pctRank(st.map((s) => ({ sym: s.sym, v: s.r3m })));
      const p6m = pctRank(st.map((s) => ({ sym: s.sym, v: s.r6m })));
      const p1y = pctRank(st.map((s) => ({ sym: s.sym, v: s.r1y })));
      return st
        .map((s) => ({ sym: s.sym, rs: 0.1 * p1w.get(s.sym)! + 0.2 * p3m.get(s.sym)! + 0.3 * p6m.get(s.sym)! + 0.4 * p1y.get(s.sym)! }))
        .sort((a, b) => b.rs - a.rs)
        .slice(0, 25)
        .map((x) => x.sym);
    },
  },
  {
    key: "breakout",
    label: "Breakout tag",
    desc: "Within 3% of the 52-week (closing) high + golden cross + above the 200-day — the Leaders board's breakout rule.",
    pick: (st) =>
      st
        .filter((s) => s.pctFromHigh >= -3 && s.goldenCross && s.aboveMa200)
        .sort((a, b) => b.pctFromHigh - a.pctFromHigh)
        .slice(0, 40)
        .map((s) => s.sym),
  },
  {
    key: "mom_12_1",
    label: "Momentum 12−1",
    desc: "Top 25 by return from 12 months ago to 1 month ago (skips the reversal month) — the academic classic.",
    pick: (st) => [...st].sort((a, b) => b.mom121 - a.mom121).slice(0, 25).map((s) => s.sym),
  },
  {
    key: "rsi_oversold",
    label: "Oversold bounce (RSI<30)",
    desc: "RSI(14) below 30, most oversold first — the mean-reversion counterpoint to the momentum sleeves.",
    pick: (st) => st.filter((s) => s.rsi14 < 30).sort((a, b) => a.rsi14 - b.rsi14).slice(0, 40).map((s) => s.sym),
  },
];

// ── engine ─────────────────────────────────────────────────────────────────────────────────────
export const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
};

/** The shared rebalance panel: master calendar, month-end rebalance days, and per-name close arrays.
 *  Exported + used by BOTH runBacktest and lib/signalGrid so the two can never disagree about which
 *  days are rebalances or which bars are in scope. */
export interface BtPanel {
  days: number[];
  rebalances: number[];
  closes: Map<string, number[]>;
  idxOf: Map<string, Map<number, number>>;
}

export function buildPanel(series: Map<string, [number, number][]>): BtPanel | null {
  // Master calendar: every day at least 60% of names traded (drops half-holidays/new-listing gaps).
  const dayCount = new Map<number, number>();
  for (const s of series.values()) for (const [t] of s) dayCount.set(t, (dayCount.get(t) ?? 0) + 1);
  const floor = Math.max(10, series.size * 0.6);
  const days = [...dayCount.entries()].filter(([, n]) => n >= floor).map(([t]) => t).sort((a, b) => a - b);
  if (days.length < 320) return null;

  // Month-end rebalance days (last qualifying trading day of each month), warmup ≥ 260 bars.
  const rebalances: number[] = [];
  for (let i = 260; i < days.length - 1; i++) {
    const m = new Date(days[i]).getUTCMonth(), m2 = new Date(days[i + 1]).getUTCMonth();
    if (m !== m2) rebalances.push(days[i]);
  }
  if (days.length >= 261) rebalances.push(days[days.length - 1]); // today's membership, fwd fills in later runs
  if (!rebalances.length) return null;

  // Per-name close arrays + t→index maps.
  const closes = new Map<string, number[]>();
  const idxOf = new Map<string, Map<number, number>>();
  for (const [sym, s] of series) {
    closes.set(sym, s.map((b) => b[1]));
    idxOf.set(sym, new Map(s.map((b, i) => [b[0], i])));
  }
  return { days, rebalances, closes, idxOf };
}

/** Every eligible name's point-in-time state at rebalance day `t` (the expensive step — compute ONCE
 *  per rebalance and reuse across every signal/param that reads it). */
export function statesAt(panel: BtPanel, t: number): NameState[] {
  const states: NameState[] = [];
  for (const [sym, c] of panel.closes) {
    const i = panel.idxOf.get(sym)!.get(t);
    if (i == null) continue;
    const st = stateAt(sym, c, i);
    if (st) states.push(st);
  }
  return states;
}

/** Run the whole backtest over {symbol → [t, close][]} series. Pure; deterministic. */
export function runBacktest(series: Map<string, [number, number][]>, universe = "sp500"): BacktestFile | null {
  const panel = buildPanel(series);
  if (!panel) return null;
  const { rebalances } = panel;

  type Obs = { fwd: number; edge: number; beatMedian: boolean };
  const bySignal = new Map<string, { obs: Record<BtHorizonKey, Obs[]>; curve: { t: number; cum: number }[]; picksTotal: number; rebs: number; perRebEdge: Record<BtHorizonKey, number[]> }>();
  for (const s of SIGNALS) bySignal.set(s.key, { obs: { w1: [], m1: [], m3: [] }, curve: [], picksTotal: 0, rebs: 0, perRebEdge: { w1: [], m1: [], m3: [] } });
  const everEligible = new Set<string>();

  for (const t of rebalances) {
    const states = statesAt(panel, t);
    for (const s of states) everEligible.add(s.sym);
    if (states.length < 50) continue;
    const bySym = new Map(states.map((s) => [s.sym, s]));

    // pool stats per horizon (names with a complete forward window only)
    const pool: Record<BtHorizonKey, { avg: number; med: number } | null> = { w1: null, m1: null, m3: null };
    for (const h of BT_HORIZONS) {
      const xs = states.map((s) => s.fwd[h.key]).filter((x): x is number => x != null);
      if (xs.length >= 50) pool[h.key] = { avg: xs.reduce((a, b) => a + b, 0) / xs.length, med: median(xs) };
    }

    for (const sig of SIGNALS) {
      const picks = sig.pick(states);
      if (!picks.length) continue;
      const box = bySignal.get(sig.key)!;
      box.picksTotal += picks.length;
      box.rebs++;
      for (const h of BT_HORIZONS) {
        const p = pool[h.key];
        if (!p) continue;
        const fwds = picks.map((sym) => bySym.get(sym)!.fwd[h.key]).filter((x): x is number => x != null);
        if (!fwds.length) continue;
        for (const f of fwds) box.obs[h.key].push({ fwd: f, edge: f - p.avg, beatMedian: f > p.med });
        box.perRebEdge[h.key].push(fwds.reduce((a, b) => a + b, 0) / fwds.length - p.avg);
        if (h.key === "m1") {
          const prev = box.curve.length ? box.curve[box.curve.length - 1].cum : 0;
          box.curve.push({ t, cum: +(prev + (fwds.reduce((a, b) => a + b, 0) / fwds.length - p.avg)).toFixed(3) });
        }
      }
    }
  }

  const signals: BtSignal[] = SIGNALS.map((sig) => {
    const box = bySignal.get(sig.key)!;
    const horizons = {} as BtSignal["horizons"];
    for (const h of BT_HORIZONS) {
      const o = box.obs[h.key];
      const perReb = box.perRebEdge[h.key];
      horizons[h.key] = o.length < 30
        ? null
        : {
            avg: +(o.reduce((a, b) => a + b.fwd, 0) / o.length).toFixed(2),
            poolAvg: +(o.reduce((a, b) => a + (b.fwd - b.edge), 0) / o.length).toFixed(2),
            edge: +(perReb.reduce((a, b) => a + b, 0) / perReb.length).toFixed(2),
            hit: +(o.filter((x) => x.beatMedian).length / o.length).toFixed(3),
            n: o.length,
          };
    }
    return { key: sig.key, label: sig.label, desc: sig.desc, avgPicks: box.rebs ? +(box.picksTotal / box.rebs).toFixed(1) : 0, horizons, curve: box.curve };
  });

  return {
    generatedAt: new Date().toISOString(),
    universe,
    start: new Date(rebalances[0]).toISOString().slice(0, 10),
    end: new Date(rebalances[rebalances.length - 1]).toISOString().slice(0, 10),
    rebalances: rebalances.length,
    names: everEligible.size,
    signals,
    method: BT_METHOD,
  };
}
