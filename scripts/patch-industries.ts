/**
 * Refines the sector-level "Health Care"/"Financials"/… industry labels that the broad constituent
 * lists (Russell 3000 especially) leave on their small-cap tail. build-data only enriches names that
 * are MISSING an ETF; these already have one, so they keep the coarse label. This patch finds every
 * generic-labeled name across the US snapshots, pulls Yahoo's real `assetProfile.industry`, maps it to
 * the GICS bucket the rest of the data uses (lib/industryMap), and writes it back — so a 244-name
 * "Health Care" blob splits into proper Biotechnology / Pharmaceuticals / Diagnostics / Devices.
 *
 * Sector-match guard: only applies the refined label when Yahoo's SECTOR maps to the same ETF the name
 * already sits in — so a name the constituent list mis-sectored into XLV but Yahoo calls "Asset
 * Management" stays generic instead of leaking a financials bucket into the health-care breakdown.
 *
 * Lookups are cached in data/industry-map.json (symbol → {ind, etf}; ind "" = no improvement) so
 * nightly re-runs are near-instant. Run: npm run patch-industries. Wired after refresh-data.
 */
import { promises as fsp } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { mapYahooIndustry } from "../lib/industryMap";
import { YAHOO_SECTOR_TO_ETF } from "../lib/intlConstituents";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA = path.join(process.cwd(), "data");
const US_UNIVERSES = ["sp500", "nasdaq100", "russell1000", "sp1500", "russell3000"];
const CACHE = path.join(DATA, "industry-map.json");

// Sector-level / non-specific labels that should be refined into a real sub-industry.
const GENERIC = new Set([
  "Health Care", "Financials", "Information Technology", "Technology", "Industrials",
  "Consumer Discretionary", "Consumer Staples", "Energy", "Materials", "Real Estate",
  "Utilities", "Communication Services", "Financial Services", "Consumer Cyclical",
  "Consumer Defensive", "Basic Materials", "Other", "",
]);
const isGeneric = (ind?: string | null): boolean => !ind || GENERIC.has(ind.trim());

interface Hit { ind: string; etf: string } // ind = mapped GICS label (""=none); etf = Yahoo's sector ETF

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let gate: Promise<void> = Promise.resolve();
const throttle = (gap = 120): Promise<void> => { const p = gate.then(() => sleep(gap)); gate = p; return p; };

async function fetchProfile(sym: string, tries = 2): Promise<{ sector: string | null; industry: string | null }> {
  await throttle();
  try {
    const r: any = await yf.quoteSummary(sym, { modules: ["assetProfile"] }, { validateResult: false });
    return { sector: r?.assetProfile?.sector || null, industry: r?.assetProfile?.industry || null };
  } catch {
    if (tries > 1) { await sleep(400); return fetchProfile(sym, tries - 1); }
    return { sector: null, industry: null };
  }
}

async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (i < items.length) { const k = i++; out[k] = await fn(items[k]); }
  }));
  return out;
}

async function main() {
  let cache: Record<string, Hit> = {};
  try {
    const parsed = JSON.parse(await fsp.readFile(CACHE, "utf8"));
    // accept only the new {ind,etf} shape; ignore a stale string-valued cache from an earlier version
    if (parsed && typeof parsed === "object") {
      for (const [k, v] of Object.entries(parsed)) if (v && typeof v === "object" && "ind" in (v as any)) cache[k] = v as Hit;
    }
  } catch { /* first run */ }

  // 1) load US snapshots; collect the union of generic-labeled symbols not yet cached
  const snaps: Record<string, any> = {};
  const need = new Set<string>();
  for (const u of US_UNIVERSES) {
    try {
      const snap = JSON.parse(await fsp.readFile(path.join(DATA, u, "snapshot.json"), "utf8"));
      snaps[u] = snap;
      for (const s of snap.stocks) if (s.etf && isGeneric(s.industry) && !(s.symbol in cache)) need.add(s.symbol);
    } catch { console.log(`  (no snapshot: ${u})`); }
  }
  const todo = [...need];
  console.log(`generic-labeled to classify: ${todo.length} (cache: ${Object.keys(cache).length})`);

  // 2) fetch Yahoo sector+industry → GICS label + sector ETF; cache so re-runs are cheap
  if (todo.length) {
    let done = 0;
    const fetched = await mapPool(todo, 8, async (sym) => {
      const { sector, industry } = await fetchProfile(sym);
      const mapped = industry ? mapYahooIndustry(industry) : null;
      const etf = sector ? YAHOO_SECTOR_TO_ETF[sector] || "" : "";
      if (++done % 100 === 0) console.log(`  …${done}/${todo.length}`);
      return { sym, hit: { ind: mapped && !isGeneric(mapped) ? mapped : "", etf } as Hit };
    });
    for (const { sym, hit } of fetched) cache[sym] = hit;
    await fsp.writeFile(CACHE, JSON.stringify(cache));
  }

  // 3) write the refined industry back into each snapshot — only when Yahoo's sector agrees with the
  //    ETF the name sits in (else a mis-sectored name would drop a foreign bucket into the breakdown)
  let patched = 0, skippedXsector = 0;
  const tally: Record<string, number> = {};
  for (const [u, snap] of Object.entries(snaps)) {
    let n = 0;
    for (const s of snap.stocks) {
      if (s.etf && isGeneric(s.industry)) {
        const c = cache[s.symbol];
        if (!c || !c.ind || isGeneric(c.ind)) continue;
        if (c.etf && c.etf !== s.etf) { skippedXsector++; continue; } // Yahoo sector ≠ list sector → leave generic
        s.industry = c.ind; n++; tally[c.ind] = (tally[c.ind] || 0) + 1;
      }
    }
    if (n) await fsp.writeFile(path.join(DATA, u, "snapshot.json"), JSON.stringify(snap));
    console.log(`  ${u}: refined ${n}`);
    patched += n;
  }
  const stillGeneric = Object.values(snaps).reduce((a, snap) => a + snap.stocks.filter((s: any) => s.etf && isGeneric(s.industry)).length, 0);
  console.log(`\nrefined ${patched} labels; ${skippedXsector} left generic (Yahoo sector ≠ ETF); ${stillGeneric} still generic total.`);
  console.log("top new buckets:");
  Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 12).forEach(([k, v]) => console.log(`  ${String(v).padStart(4)}  ${k}`));
}

main().catch((e) => { console.error(e); process.exit(1); });
