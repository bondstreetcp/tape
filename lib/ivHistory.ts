/**
 * IV / pre-earnings-straddle history — a nightly snapshot, around each earnings window, of a name's
 * front-expiry ATM implied vol + the straddle-implied move. Accumulated by scripts/refresh-iv-history.ts
 * → data/iv-history.json. This is the data we DON'T get anywhere else: with it we can compute, over time,
 * (1) the REALIZED IV crush after a print (IV the day before vs after), (2) IV-rank (current IV vs its own
 * history), and (3) a true long-premium backtest (the priced move each quarter vs what was realized).
 *
 * CLIENT-SAFE: types + the pure `ivStats` reader (no fs/network). Snapshots accrue going forward — empty
 * until the accumulator has run across a few earnings cycles.
 */
export interface IvSnapshot {
  date: string; // YYYY-MM-DD the snapshot was taken
  atmIV: number | null; // front-expiry ATM IV (annualized), backed out of the straddle (√(2/π) inversion)
  movePct: number | null; // ATM straddle ÷ spot — the priced event-ish move that day
  spot: number | null;
  dte: number | null; // front-expiry days-to-expiry
  daysToEarnings: number; // signed: + before the print, 0 day-of, − after
}

export interface IvHistoryData {
  generatedAt: string;
  byTicker: Record<string, IvSnapshot[]>; // chronological (oldest → newest)
}

export interface IvStats {
  ivRank: number | null; // percentile of the current ATM IV within its own snapshot history (high = vol elevated)
  curIV: number | null;
  avgCrushPct: number | null; // mean (preIV − postIV)/preIV across past prints — the realized vol decay
  crushN: number; // number of past earnings windows the crush was measured over
}

/** Derive IV-rank + the realized post-earnings IV crush from a ticker's snapshot history. Returns null
 *  until enough snapshots exist. The crush pairs the last pre-print snapshot (daysToEarnings ≥ 0, small)
 *  with the first post-print snapshot (daysToEarnings < 0) of the SAME earnings event. */
export function ivStats(snaps: IvSnapshot[] | undefined): IvStats | null {
  if (!snaps || snaps.length < 12) return null;
  const withIV = snaps.filter((s) => s.atmIV != null && s.atmIV > 0);
  if (withIV.length < 12) return null;
  const curIV = withIV[withIV.length - 1].atmIV!;
  const ivRank = (withIV.filter((s) => s.atmIV! <= curIV).length / withIV.length) * 100;

  // Realized crush: walk chronologically; an earnings event is where daysToEarnings flips from ≥0 to <0.
  const crushes: number[] = [];
  for (let i = 1; i < snaps.length; i++) {
    const prev = snaps[i - 1], cur = snaps[i];
    if (prev.daysToEarnings >= 0 && cur.daysToEarnings < 0 && prev.atmIV && cur.atmIV && prev.atmIV > 0) {
      // require the pair to bracket the print tightly (within ~5 calendar days of snapshots)
      if (Date.parse(cur.date) - Date.parse(prev.date) <= 6 * 86_400_000) crushes.push((prev.atmIV - cur.atmIV) / prev.atmIV);
    }
  }
  const avgCrushPct = crushes.length ? (crushes.reduce((a, b) => a + b, 0) / crushes.length) * 100 : null;
  return { ivRank, curIV, avgCrushPct, crushN: crushes.length };
}
