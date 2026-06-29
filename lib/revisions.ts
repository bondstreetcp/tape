/**
 * Revisions Momentum — the estimate-revision (PEAD) factor across the universe. We snapshot each
 * name's consensus EPS now vs 30/90 days ago and how many analysts revised up vs down (the block
 * already fetched per-name by getCompanyStats) into data/estimates.json nightly, then rank the
 * universe by estimate drift + revision breadth. Leaders = the Street quietly marking numbers UP
 * before the print; laggards = quiet cuts.
 */
import type { StockRow } from "./types";

// One name's snapshotted estimate block (written by scripts/refresh-estimates.ts).
export interface EstSnap {
  cyNow: number | null; // current fiscal-year consensus EPS now
  cy30d: number | null; // …30 days ago
  cy90d: number | null; // …90 days ago
  up30d: number | null; // # analysts revising up (last 30d)
  down30d: number | null; // # revising down
  nyNow: number | null; // next fiscal-year consensus EPS now
  ny90d: number | null; // …90 days ago
  price: number | null;
  target: number | null; // mean price target
  analysts: number | null;
  // analyst rating + target range (for the Analyst-Upside board) — optional so older files still load
  recKey?: string | null; // "strong_buy" | "buy" | "hold" | "sell" | "strong_sell"
  recMean?: number | null; // 1 (strong buy) … 5 (strong sell)
  targetHigh?: number | null;
  targetLow?: number | null;
  // short interest (for the Short-Squeeze Radar) — optional
  shortPctFloat?: number | null; // shortPercentOfFloat (fraction, 0.05 = 5%)
  daysToCover?: number | null; // shortRatio
  sharesShort?: number | null;
  sharesShortPrior?: number | null; // sharesShortPriorMonth
}
export interface EstimatesFile { generatedAt: string; asOf: string | null; names: Record<string, EstSnap> }

export interface RevisionRow {
  symbol: string;
  name: string;
  sector: string;
  marketCap: number;
  drift30: number | null; // % change in CY consensus EPS over 30d
  drift90: number | null; // …over 90d
  nyDrift90: number | null; // next-year EPS drift over 90d
  up30d: number;
  down30d: number;
  netUp: number; // up − down
  upsidePct: number | null; // target / price − 1
  analysts: number | null;
  score: number; // 0–100 composite revision momentum
}
export interface SectorRev { sector: string; total: number; netUpPct: number; avgDrift90: number | null }
export interface RevisionsData { rows: RevisionRow[]; sectors: SectorRev[]; asOf: string | null; coverage: number }

// Percent change with an absolute-value denominator so sign is right even for negative EPS
// (a loss narrowing from −1.00 to −0.50 is a +50% upward revision). Guards against a near-zero
// base (a recovery off ~$0 EPS produces meaningless 1000%+ drifts) and clamps the magnitude so
// those don't dominate the table — the percentile-based score is unaffected (it's rank order).
function pctChange(now: number | null, past: number | null): number | null {
  if (now == null || past == null || Math.abs(past) < 0.1) return null; // annual-EPS base too small to be meaningful
  const v = ((now - past) / Math.abs(past)) * 100;
  return Math.max(-200, Math.min(200, v));
}

function pctRank(vals: { sym: string; v: number }[]): Map<string, number> {
  const sorted = [...vals].sort((a, b) => a.v - b.v);
  const n = sorted.length;
  const m = new Map<string, number>();
  sorted.forEach((x, i) => m.set(x.sym, n > 1 ? (i / (n - 1)) * 100 : 50));
  return m;
}

export function buildRevisions(file: EstimatesFile, stocks: StockRow[]): RevisionsData {
  const bySym = new Map(stocks.map((s) => [s.symbol, s]));
  const raw: RevisionRow[] = [];
  for (const [sym, es] of Object.entries(file.names)) {
    const s = bySym.get(sym);
    if (!s) continue; // restrict to the current universe
    const drift30 = pctChange(es.cyNow, es.cy30d);
    const drift90 = pctChange(es.cyNow, es.cy90d);
    const nyDrift90 = pctChange(es.nyNow, es.ny90d);
    const up30d = es.up30d ?? 0, down30d = es.down30d ?? 0;
    const netUp = up30d - down30d;
    // Keep names with a usable revision signal.
    if (drift90 == null && drift30 == null && up30d === 0 && down30d === 0) continue;
    raw.push({
      symbol: sym,
      name: s.name,
      sector: s.sector,
      marketCap: s.marketCap,
      drift30,
      drift90,
      nyDrift90,
      up30d,
      down30d,
      netUp,
      upsidePct: es.target != null && es.price ? (es.target / es.price - 1) * 100 : null,
      analysts: es.analysts,
      score: 0,
    });
  }

  // Composite = blend of estimate-drift percentile and net-revision-breadth percentile.
  const driftRank = pctRank(raw.filter((r) => r.drift90 != null).map((r) => ({ sym: r.symbol, v: r.drift90! })));
  const breadthRank = pctRank(raw.map((r) => ({ sym: r.symbol, v: r.netUp })));
  for (const r of raw) {
    const d = driftRank.get(r.symbol) ?? 50;
    const b = breadthRank.get(r.symbol) ?? 50;
    r.score = Math.round(0.6 * d + 0.4 * b);
  }
  raw.sort((a, b) => b.score - a.score);

  // Sector revision breadth.
  const bySector = new Map<string, RevisionRow[]>();
  for (const r of raw) {
    if (!r.sector) continue;
    const l = bySector.get(r.sector);
    if (l) l.push(r);
    else bySector.set(r.sector, [r]);
  }
  const sectors: SectorRev[] = [...bySector.entries()]
    .map(([sector, list]) => {
      const drifts = list.map((r) => r.drift90).filter((v): v is number => v != null);
      return {
        sector,
        total: list.length,
        netUpPct: Math.round((list.filter((r) => r.netUp > 0).length / list.length) * 100),
        avgDrift90: drifts.length ? drifts.reduce((a, b) => a + b, 0) / drifts.length : null,
      };
    })
    .sort((a, b) => (b.avgDrift90 ?? -99) - (a.avgDrift90 ?? -99));

  return { rows: raw, sectors, asOf: file.asOf, coverage: raw.length };
}
