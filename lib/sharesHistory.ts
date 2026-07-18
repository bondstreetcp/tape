import { yahoo } from "./yahooClient";
import { tickerToCik } from "./edgar";

/**
 * Long-run shares-outstanding history (10+ years) from SEC EDGAR XBRL companyfacts —
 * Yahoo only serves ~4-5 annual periods. Uses the weighted-average diluted share count
 * (the EPS denominator, a total across share classes). Share counts are NOT year-to-date
 * cumulative, so discrete quarters / full years read straight off the fact spans (~90d =
 * a quarter, ~365d = a fiscal year).
 *
 * Split-adjustment: companyfacts reports each period in the split basis that was current
 * WHEN it was filed, so a long series crosses stock splits (e.g. AAPL 889M in 2007 vs 15B
 * now is the 7:1 + 4:1 splits, not dilution). We take the AS-ORIGINALLY-REPORTED value for
 * each period (earliest filing) and multiply by the product of every split that happened
 * after it, putting the whole series on today's share basis.
 */
const UA = "stock-chart-screener research jameslyeh@gmail.com";
const DAY = 86_400_000;
const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

export interface SharesHistory { annual: [string, number][]; quarterly: [string, number][] }

const DUR_CONCEPTS = [
  "WeightedAverageNumberOfDilutedSharesOutstanding",
  "WeightedAverageNumberOfShareOutstandingBasicAndDiluted",
  "WeightedAverageNumberOfSharesOutstandingBasic",
];

async function getSplits(symbol: string): Promise<{ t: number; ratio: number }[]> {
  try {
    const ch: any = await yahoo.chart(symbol, { period1: new Date("2000-01-01"), interval: "1mo", events: "splits" } as any, { validateResult: false });
    const ev = ch?.events?.splits;
    const arr: any[] = Array.isArray(ev) ? ev : ev ? Object.values(ev) : [];
    return arr
      .map((s) => ({ t: new Date(s.date).getTime(), ratio: s.numerator && s.denominator ? s.numerator / s.denominator : 0 }))
      .filter((s) => Number.isFinite(s.t) && s.ratio > 0 && Math.abs(s.ratio - 1) > 1e-6);
  } catch {
    return [];
  }
}

// Multiply each point by the product of splits that occurred AFTER its date → today's basis.
function splitAdjust(series: [string, number][], splits: { t: number; ratio: number }[]): [string, number][] {
  if (!splits.length) return series;
  return series.map(([d, v]) => {
    const t = Date.parse(d);
    let f = 1;
    for (const s of splits) if (s.t > t) f *= s.ratio;
    return [d, Math.round(v * f)] as [string, number];
  });
}

// Drop pre-2011 points (early XBRL is unreliable — e.g. stray fragments orders of
// magnitude off) and any remaining gross outlier (>5× or <⅕ the median).
const MIN_T = Date.parse("2011-01-01");
function clean(series: [string, number][]): [string, number][] {
  const s = series.filter(([d]) => Date.parse(d) >= MIN_T);
  if (s.length < 3) return s;
  const med = [...s.map((p) => p[1])].sort((a, b) => a - b)[Math.floor(s.length / 2)];
  return s.filter(([, v]) => v >= med * 0.2 && v <= med * 5);
}

export async function getSharesHistory(symbol: string): Promise<SharesHistory> {
  const empty: SharesHistory = { annual: [], quarterly: [] };
  try {
    const cik = await tickerToCik(symbol);
    if (!cik) return empty;
    const padded = cik.replace(/\D/g, "").padStart(10, "0");
    const [res, splits] = await Promise.all([
      fetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`, { headers: { "User-Agent": UA }, next: { revalidate: 86400 } } as any),
      getSplits(symbol),
    ]);
    if (!res.ok) return empty;
    const json: any = await res.json();
    const gaap = json?.facts?.["us-gaap"] ?? {};

    let facts: any[] | null = null;
    for (const c of DUR_CONCEPTS) {
      const u = gaap[c]?.units?.shares;
      if (Array.isArray(u) && u.length) { facts = u; break; }
    }

    if (facts) {
      const q = new Map<string, { v: number; filed: string }>();
      const a = new Map<string, { v: number; filed: string }>();
      for (const f of facts) {
        if (typeof f.val !== "number" || f.val <= 0 || !f.end || !f.start) continue;
        const sp = span(f.start, f.end);
        const m = sp >= 80 && sp <= 100 ? q : sp >= 350 && sp <= 380 ? a : null;
        if (!m) continue;
        const prev = m.get(f.end);
        // keep the AS-ORIGINALLY-REPORTED value (earliest filing) so split-adjustment is uniform
        if (!prev || (f.filed && f.filed < prev.filed)) m.set(f.end, { v: f.val, filed: f.filed || "9999" });
      }
      const ser = (m: Map<string, { v: number; filed: string }>) =>
        clean(splitAdjust([...m.entries()].map(([d, x]) => [d, x.v] as [string, number]).sort((p, n) => p[0].localeCompare(n[0])), splits));
      const out = { annual: ser(a), quarterly: ser(q) };
      if (out.annual.length >= 2 || out.quarterly.length >= 2) return out;
    }

    // Fallback: the cover-page instant share count (each as-of-filing, also split-adjusted).
    const inst: any[] | undefined =
      json?.facts?.dei?.EntityCommonStockSharesOutstanding?.units?.shares ?? gaap.CommonStockSharesOutstanding?.units?.shares;
    if (Array.isArray(inst) && inst.length) {
      const byDate = new Map<string, { v: number; filed: string }>();
      for (const f of inst) {
        if (typeof f.val !== "number" || f.val <= 0 || !f.end) continue;
        const prev = byDate.get(f.end);
        if (!prev || (f.filed && f.filed < prev.filed)) byDate.set(f.end, { v: f.val, filed: f.filed || "9999" });
      }
      const all = clean(splitAdjust([...byDate.entries()].map(([d, x]) => [d, x.v] as [string, number]).sort((p, n) => p[0].localeCompare(n[0])), splits));
      const byYear = new Map<string, [string, number]>();
      for (const p of all) byYear.set(p[0].slice(0, 4), p);
      return { annual: [...byYear.values()].sort((p, n) => p[0].localeCompare(n[0])), quarterly: all };
    }
    return empty;
  } catch {
    return empty;
  }
}
