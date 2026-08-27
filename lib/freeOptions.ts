/**
 * "Free options" screener — reasonably-priced stocks TODAY with under-appreciated multi-year earnings
 * power. The thesis: when a profitable, growing company trades at a modest multiple, you're handed the
 * future growth cheaply — a "free option" on the earnings the market isn't yet paying for. Ranks the
 * universe by (growth priced cheap) × (a real, inflecting trajectory) × quality, from the snapshot's
 * trend fundamentals (fund) + the estimates feed (forward EPS + revisions). Built at request time.
 * Decision-support, not advice.
 */
import type { StockRow } from "./types";
import type { EstimatesFile } from "./revisions";

export interface FreeOptionRow {
  symbol: string;
  name: string;
  sector: string;
  marketCap: number;
  price: number | null;
  fwdPE: number | null; // price / next-fiscal-year consensus EPS
  epsGrowthPct: number | null; // CY→NY forward EPS growth
  peg: number | null; // fwdPE / growth%
  fwd3PE: number | null; // the multiple 3yr out if growth holds — the "free" part
  revCagr3yPct: number | null;
  opMarginChgPct: number | null; // YoY op-margin change (pp)
  cyDriftPct: number | null; // CY EPS revised over 90d
  nyDriftPct: number | null;
  netUp: number; // analysts up − down (30d)
  ptUpsidePct: number | null;
  analysts: number | null;
  fScore: number | null;
  score: number; // 0–100
  why: string;
}

export interface FreeOptionsData {
  asOf: string;
  universe: string;
  count: number;
  rows: FreeOptionRow[];
}

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const pctChange = (a: number | null | undefined, b: number | null | undefined): number | null =>
  a != null && b != null && Math.abs(b) > 1e-9 ? (a - b) / Math.abs(b) : null;

/** Rank the universe by "free option" strength. `limit` caps the returned list. */
export function buildFreeOptions(rows: StockRow[], est: EstimatesFile | null, universe: string, limit = 40): FreeOptionsData {
  const names = est?.names ?? {};
  const out: FreeOptionRow[] = [];

  for (const r of rows) {
    const es = names[r.symbol];
    if (!es) continue;
    const cyNow = es.cyNow, nyNow = es.nyNow;
    // Profitable earnings base (a tiny/negative base makes growth + PEG meaningless — the revisions
    // board's own $0-EPS caveat) and a real, non-noise forward growth rate.
    if (cyNow == null || nyNow == null || cyNow <= 0.2 || nyNow <= 0) continue;
    const g = (nyNow - cyNow) / cyNow;
    if (!(g >= 0.08 && g < 0.8)) continue;
    const price = r.price ?? es.price ?? null;
    if (price == null || price <= 0) continue;
    const fwdPE = price / nyNow;
    if (!(fwdPE >= 4 && fwdPE <= 45)) continue; // reasonable, not distressed, not absurd
    if ((r.marketCap ?? 0) < 1e9) continue; // liquid enough to act on
    const analysts = es.analysts ?? null;
    if ((analysts ?? 0) < 3) continue; // data reliability
    const cyDrift = pctChange(cyNow, es.cy90d);
    if (cyDrift != null && cyDrift < -0.03) continue; // estimates being cut > 3% → melting, not inflecting

    const f = r.fund ?? null;
    const peg = fwdPE / (g * 100);
    const fwd3PE = fwdPE / Math.pow(1 + g, 2);
    const revCagr = f?.revCagr3y ?? null;
    const opMarginChg = f?.opMarginChg ?? null;
    const nyDrift = pctChange(nyNow, es.ny90d);
    const netUp = (es.up30d ?? 0) - (es.down30d ?? 0);
    const ptUpside = es.target != null ? es.target / price - 1 : null;
    const fScore = f?.fScore ?? null;
    const roic = f?.roic ?? null;

    // ── score (0–100) ──
    const growthCheap = 40 * clamp01((1.5 - peg) / 1.3); // the heart: growth for a low multiple (PEG)
    const runway = 25 * (0.5 * clamp01((revCagr ?? 0) / 0.25) + 0.25 * ((opMarginChg ?? 0) > 0 ? 1 : 0) + 0.25 * clamp01((g - 0.1) / 0.3));
    const expects = 20 * (0.4 * clamp01((cyDrift ?? 0) / 0.05) + 0.3 * clamp01(netUp / 5) + 0.3 * clamp01((nyDrift ?? 0) / 0.05));
    const quality = 15 * (0.4 * clamp01(((fScore ?? 4) - 4) / 4) + 0.3 * clamp01((roic ?? 0) / 0.15) + 0.3 * clamp01((ptUpside ?? 0) / 0.3));
    const score = Math.round(growthCheap + runway + expects + quality);

    const why = [
      `Fwd P/E ${fwdPE.toFixed(0)} on +${(g * 100).toFixed(0)}% EPS growth (PEG ${peg.toFixed(1)})`,
      fwd3PE < fwdPE * 0.85 ? `~${fwd3PE.toFixed(0)} on 3-yr-out EPS` : null,
      revCagr != null && revCagr > 0.05 ? `rev CAGR +${(revCagr * 100).toFixed(0)}%` : null,
      (cyDrift != null && cyDrift > 0.01) || netUp > 0 ? `revisions ↑${netUp > 0 ? ` (net +${netUp})` : ""}` : null,
      ptUpside != null && ptUpside > 0.05 ? `+${(ptUpside * 100).toFixed(0)}% to PT` : null,
    ].filter(Boolean).join(" · ");

    out.push({
      symbol: r.symbol, name: r.name, sector: r.sector, marketCap: r.marketCap, price,
      fwdPE, epsGrowthPct: g * 100, peg, fwd3PE,
      revCagr3yPct: revCagr != null ? revCagr * 100 : null,
      opMarginChgPct: opMarginChg != null ? opMarginChg * 100 : null,
      cyDriftPct: cyDrift != null ? cyDrift * 100 : null,
      nyDriftPct: nyDrift != null ? nyDrift * 100 : null,
      netUp, ptUpsidePct: ptUpside != null ? ptUpside * 100 : null, analysts, fScore, score, why,
    });
  }

  out.sort((a, b) => b.score - a.score);
  return { asOf: est?.asOf ?? new Date().toISOString(), universe, count: out.length, rows: out.slice(0, limit) };
}
