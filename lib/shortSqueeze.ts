/**
 * Short-Squeeze Radar — ranks the universe by squeeze setup: short interest as a % of float, days
 * to cover (short ratio = shares short ÷ avg daily volume), and whether shorts are rising month over
 * month (more fuel). Crowded + hard-to-cover + still being pressed is the classic squeeze profile.
 * Reads the per-name short-interest block from the nightly estimate snapshot (data/estimates.json,
 * sourced from Yahoo — US names only). Drill into a candidate's live borrow cost on its stock page.
 */
import type { StockRow } from "./types";
import type { EstimatesFile } from "./revisions";

export type SqueezeTier = "Extreme" | "High" | "Elevated" | "Moderate";

export interface SqueezeRow {
  symbol: string;
  name: string;
  sector: string;
  marketCap: number;
  price: number;
  shortPctFloat: number | null; // fraction (0.20 = 20%)
  daysToCover: number | null;
  shortMomPct: number | null; // MoM % change in shares short (rising = more fuel)
  pctFromHigh: number;
  pctFromLow: number;
  tier: SqueezeTier;
  score: number; // 0–100 composite
}
export interface SqueezeData { rows: SqueezeRow[]; coverage: number; asOf: string | null }

const tierOf = (pf: number | null): SqueezeTier =>
  pf == null ? "Moderate" : pf >= 0.2 ? "Extreme" : pf >= 0.1 ? "High" : pf >= 0.05 ? "Elevated" : "Moderate";

export const TIER_COLOR: Record<SqueezeTier, string> = {
  Extreme: "#ef4444",
  High: "#f59e0b",
  Elevated: "#eab308",
  Moderate: "#8b93a7",
};

function pctRank(vals: { sym: string; v: number }[]): Map<string, number> {
  const sorted = [...vals].sort((a, b) => a.v - b.v);
  const n = sorted.length;
  const m = new Map<string, number>();
  sorted.forEach((x, i) => m.set(x.sym, n > 1 ? (i / (n - 1)) * 100 : 50));
  return m;
}

export function buildSqueeze(file: EstimatesFile, stocks: StockRow[]): SqueezeData {
  const bySym = new Map(stocks.map((s) => [s.symbol, s]));
  const raw: SqueezeRow[] = [];
  for (const [sym, es] of Object.entries(file.names)) {
    const s = bySym.get(sym);
    if (!s) continue; // restrict to the current universe
    const pf = es.shortPctFloat ?? null;
    if (pf == null || pf < 0.02) continue; // below ~2% of float isn't squeezable
    const shortMomPct = es.sharesShort != null && es.sharesShortPrior != null && es.sharesShortPrior > 0 ? ((es.sharesShort - es.sharesShortPrior) / es.sharesShortPrior) * 100 : null;
    raw.push({
      symbol: sym,
      name: s.name,
      sector: s.sector,
      marketCap: s.marketCap,
      price: s.price,
      shortPctFloat: pf,
      daysToCover: es.daysToCover ?? null,
      shortMomPct,
      pctFromHigh: s.pctFromHigh,
      pctFromLow: s.pctFromLow,
      tier: tierOf(pf),
      score: 0,
    });
  }

  // Composite = 0.5 short %float + 0.3 days-to-cover + 0.2 rising-shorts momentum.
  const rFloat = pctRank(raw.map((r) => ({ sym: r.symbol, v: r.shortPctFloat ?? 0 })));
  const rDtc = pctRank(raw.map((r) => ({ sym: r.symbol, v: r.daysToCover ?? 0 })));
  const rMom = pctRank(raw.map((r) => ({ sym: r.symbol, v: r.shortMomPct ?? 0 })));
  for (const r of raw) {
    r.score = Math.round(0.5 * (rFloat.get(r.symbol) ?? 50) + 0.3 * (rDtc.get(r.symbol) ?? 50) + 0.2 * (rMom.get(r.symbol) ?? 50));
  }
  raw.sort((a, b) => b.score - a.score || (b.shortPctFloat ?? 0) - (a.shortPctFloat ?? 0));

  return { rows: raw, coverage: raw.length, asOf: file.asOf };
}
