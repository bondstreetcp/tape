/**
 * refresh-index-valuation — synthesize an INDEX valuation-multiple history from the per-name series
 * already in data/valuation-history.json. For the S&P 500, at each reporting month we take the MEDIAN
 * multiple (P/E, EV/EBITDA, P/S, P/B) across the constituents that have data (carry-forward of each
 * name's most-recent value). Powers the "valuation vs index over time" view. Writes
 * data/index-valuation-history.json.
 *
 * Honest scope: median-of-ratios over TODAY's members (survivorship-biased back-build), not a rigorous
 * cap-weighted point-in-time index P/E. A relative gauge. Runs in the nightly FULL after
 * refresh-valuation-history. US-only.
 */
import { promises as fs } from "fs";
import path from "path";
import type { ValuationHistoryData, MultipleKey } from "../lib/valuationHistory";
import type { IndexValuationData } from "../lib/relValuation";

const DATA = path.join(process.cwd(), "data");
const MULTIPLES: MultipleKey[] = ["pe", "evEbitda", "ps", "pb"];
const MIN_NAMES = 30; // need at least this many constituents at a month to publish a median
const median = (xs: number[]) => { const a = [...xs].sort((p, q) => p - q); const m = Math.floor(a.length / 2); return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };

function valueOnOrBefore(series: [string, number][], ym: string): number | null {
  let ans: number | null = null;
  for (const [k, v] of series) { if (k <= ym) ans = v; else break; }
  return ans;
}

async function symbolSet(universe: string): Promise<Set<string>> {
  try {
    const raw = JSON.parse(await fs.readFile(path.join(DATA, "constituents", `${universe}.json`), "utf8"));
    const arr = Array.isArray(raw) ? raw : raw.symbols || raw.constituents || [];
    return new Set(arr.map((x: any) => (typeof x === "string" ? x : x.symbol || x.ticker)).filter(Boolean));
  } catch {
    const snap = JSON.parse(await fs.readFile(path.join(DATA, universe, "snapshot.json"), "utf8"));
    return new Set((snap.stocks || []).map((s: any) => s.symbol));
  }
}

async function main() {
  const vh = JSON.parse(await fs.readFile(path.join(DATA, "valuation-history.json"), "utf8")) as ValuationHistoryData;
  const universe = "sp500";
  const set = await symbolSet(universe);
  console.log(`Index valuation over ${set.size} ${universe} constituents…`);

  const series: IndexValuationData["series"] = {};
  const coverage: IndexValuationData["coverage"] = {};
  for (const mk of MULTIPLES) {
    // gather every constituent's series for this multiple
    const cons: [string, number][][] = [];
    for (const [sym, n] of Object.entries(vh.names)) {
      if (!set.has(sym)) continue;
      const s = n.multiples?.[mk]?.series;
      if (s && s.length) cons.push(s);
    }
    if (cons.length < MIN_NAMES) { console.log(`  ${mk}: only ${cons.length} names — skipped`); continue; }
    const allYm = [...new Set(cons.flatMap((s) => s.map((x) => x[0])))].sort();
    const out: [string, number][] = [];
    let nSum = 0, nPts = 0;
    for (const ym of allYm) {
      const vals: number[] = [];
      for (const s of cons) { const v = valueOnOrBefore(s, ym); if (v != null && v > 0) vals.push(v); }
      if (vals.length >= MIN_NAMES) { out.push([ym, Math.round(median(vals) * 100) / 100]); nSum += vals.length; nPts++; }
    }
    if (out.length) { series[mk] = out; coverage[mk] = Math.round(nSum / nPts); console.log(`  ${mk}: ${out.length} months · avg ${coverage[mk]} names · latest median ${out[out.length - 1][1]}`); }
  }

  const data: IndexValuationData = {
    generatedAt: new Date().toISOString(),
    asOf: vh.asOf,
    universe,
    label: "S&P 500",
    series,
    coverage,
  };
  await fs.writeFile(path.join(DATA, "index-valuation-history.json"), JSON.stringify(data));
  console.log(`Wrote data/index-valuation-history.json`);
}

main().catch((e) => { console.error(e); process.exit(1); });
