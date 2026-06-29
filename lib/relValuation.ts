/**
 * Valuation vs the index, over time. We synthesize an INDEX multiple history (the median multiple
 * across the S&P 500 at each point, from the per-name series already in valuation-history.json) and
 * then express a company's multiple RELATIVE to it: company P/E ÷ index P/E over ~10 years, vs that
 * relative's own median. "Trades at 1.4× the index P/E, vs a 10yr-relative norm of 1.2×" → richer
 * than usual vs the market.
 *
 * Honest scope: the index series is a MEDIAN-of-ratios over TODAY's members (survivorship-biased
 * back-build), not a rigorous cap-weighted point-in-time index P/E — a relative-richness gauge, not
 * the institutional series. US names only (the underlying valuation history is EDGAR-built). No fs
 * here — this module is imported by the client; the API route reads the JSON.
 */
import type { MultipleKey } from "./valuationHistory";

export interface IndexValuationData {
  generatedAt: string;
  asOf: string | null;
  universe: string; // the benchmark the median is taken over (e.g. "sp500")
  label: string; // display label ("S&P 500")
  series: Partial<Record<MultipleKey, [string, number][]>>; // index median multiple, ["YYYY-MM", value]
  coverage: Partial<Record<MultipleKey, number>>; // avg # of constituents behind each point
}

export interface RelPoint { ym: string; co: number; idx: number; rel: number }
export interface RelStat {
  mk: MultipleKey;
  current: number | null; // latest company multiple
  currentIdx: number | null; // latest index multiple
  currentRel: number | null; // company ÷ index now
  medianRel: number | null; // median of the relative over the history
  pctOfMedian: number | null; // currentRel / medianRel − 1, in % (negative = cheaper vs its own relative norm)
  z: number | null;
  series: RelPoint[];
}

const median = (xs: number[]): number => { const a = [...xs].sort((p, q) => p - q); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

/** Last value at or before `ym` in an oldest→newest [ym,value] series. */
function valueOnOrBefore(series: [string, number][], ym: string): number | null {
  let ans: number | null = null;
  for (const [k, v] of series) { if (k <= ym) ans = v; else break; }
  return ans;
}

/** Build the company-vs-index relative series + stats for one multiple. */
export function buildRelStat(mk: MultipleKey, coSeries: [string, number][] | undefined, idxSeries: [string, number][] | undefined): RelStat | null {
  if (!coSeries?.length || !idxSeries?.length) return null;
  const pts: RelPoint[] = [];
  for (const [ym, co] of coSeries) {
    const idx = valueOnOrBefore(idxSeries, ym);
    if (idx != null && idx > 0 && co > 0) pts.push({ ym, co, idx, rel: co / idx });
  }
  if (pts.length < 6) return null;
  const rels = pts.map((p) => p.rel);
  const cur = pts[pts.length - 1];
  const med = median(rels);
  const mean = rels.reduce((a, b) => a + b, 0) / rels.length;
  const sd = Math.sqrt(rels.reduce((a, b) => a + (b - mean) ** 2, 0) / rels.length) || 0;
  return {
    mk,
    current: cur.co,
    currentIdx: cur.idx,
    currentRel: cur.rel,
    medianRel: med,
    pctOfMedian: med ? (cur.rel / med - 1) * 100 : null,
    z: sd ? (cur.rel - med) / sd : null,
    series: pts,
  };
}
