/**
 * Builds data/buybacks.json — the Buyback & Capital-Return board.
 *
 * For each S&P 500 name, one SEC XBRL companyfacts pull yields the raw flow concepts (cash spent on
 * repurchases, dividends paid, operating cash flow, capex) and the share count. We de-cumulate the
 * YTD-cumulative cash-flow facts into quarters (lib/buybacks.quarterize), sum a trailing-twelve-months,
 * and compute:
 *   • buyback yield = TTM repurchases ÷ market cap        (how much value is returned via buybacks)
 *   • total shareholder yield = buyback yield + div yield (the shareholder-yield factor)
 *   • net share-count change YoY                          (NEGATIVE = the count is REALLY shrinking)
 *   • buyback acceleration = latest-Q pace ÷ TTM run-rate (is repurchasing ramping up?)
 *   • payout ÷ FCF (annual basis)                         (>1 = returning more than it earns)
 * All grounded in the filings — no LLM. Run: npm run refresh-buybacks. Nightly FULL.
 */
import { loadSnapshot } from "../lib/data";
import { tickerToCik } from "../lib/edgar";
import { writeFeedGuarded } from "../lib/feedGuard";
import {
  quarterize, despikeQuarters, ttmSum, yoyChange, classifyBuyback,
  type BuybackRow, type BuybackData, type DurFact, type InstFact,
} from "../lib/buybacks";

const OUT = "buybacks.json"; // written via the registry-backed guard (lib/feedGuard), not raw fs
const UA = "stock-chart-screener research jameslyeh@gmail.com";
const DAY = 86_400_000;
const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const CAP = Number(process.env.CAP || 0); // optional: limit names (for a quick test run)

// Throttled SEC fetch — a global gate keeps us well under SEC's 10 req/s across the concurrent pool.
let gate: Promise<void> = Promise.resolve();
const throttle = (ms = 120): Promise<void> => { const p = gate.then(() => sleep(ms)); gate = p; return p; };
async function secFetch(url: string): Promise<Response | null> {
  for (let i = 0; i < 3; i++) {
    await throttle();
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
      if (r.ok) return r;
      if (r.status === 404) return null;
    } catch { /* retry */ }
    await sleep(500 * (i + 1));
  }
  return null;
}

async function mapPool<T, R>(items: T[], n: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let idx = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => {
    while (idx < items.length) { const i = idx++; try { out[i] = await fn(items[i], i); } catch { out[i] = null as any; } }
  }));
  return out;
}

/** First concept (in preference order) that has USD duration facts → normalized DurFact[]. */
function durFacts(gaap: any, concepts: string[]): DurFact[] {
  for (const c of concepts) {
    const arr = gaap?.[c]?.units?.USD;
    if (Array.isArray(arr) && arr.length)
      return arr
        .filter((f: any) => f?.start && f?.end && typeof f.val === "number")
        .map((f: any) => ({ start: f.start, end: f.end, val: f.val, fy: f.fy, accn: f.accn }));
  }
  return [];
}

/** Latest clean annual (FY, ~365d span) figure for a flow concept — the robust fallback when the
 *  quarterly de-cumulation can't assemble a full TTM. */
function annualFlow(facts: DurFact[]): { val: number; asOf: string } | null {
  const fy = facts.filter((f) => { const s = span(f.start, f.end); return s >= 350 && s <= 380; });
  // latest-filed wins per period-end, then take the newest period
  const m = new Map<string, DurFact>();
  for (const f of fy.sort((a, b) => String(a.accn ?? "").localeCompare(String(b.accn ?? "")))) m.set(f.end, f);
  const rows = [...m.values()].sort((a, b) => a.end.localeCompare(b.end));
  return rows.length ? { val: rows[rows.length - 1].val, asOf: rows[rows.length - 1].end } : null;
}

/** TTM-preferred (de-spiked), annual-fallback total for a flow concept. */
function flowTtm(facts: DurFact[]): { val: number; asOf: string } | null {
  return ttmSum(despikeQuarters(quarterize(facts))) ?? annualFlow(facts);
}

/** Share count as instant-like points for a YoY read: prefer annual diluted weighted-avg shares
 *  (single consolidated number), fall back to instant shares-outstanding. */
function shareSeries(gaap: any, dei: any): InstFact[] {
  const waso = gaap?.WeightedAverageNumberOfDilutedSharesOutstanding?.units?.shares;
  if (Array.isArray(waso)) {
    const fy = waso.filter((f: any) => f?.start && f?.end && typeof f.val === "number" && span(f.start, f.end) >= 350 && span(f.start, f.end) <= 380);
    if (fy.length >= 2) {
      const m = new Map<string, number>();
      for (const f of fy.sort((a: any, b: any) => String(a.accn ?? "").localeCompare(String(b.accn ?? "")))) m.set(f.end, f.val);
      return [...m.entries()].map(([end, val]) => ({ end, val }));
    }
  }
  const cso = gaap?.CommonStockSharesOutstanding?.units?.shares ?? dei?.EntityCommonStockSharesOutstanding?.units?.shares;
  if (Array.isArray(cso)) {
    const m = new Map<string, number>();
    for (const f of cso.filter((f: any) => f?.end && typeof f.val === "number").sort((a: any, b: any) => String(a.accn ?? "").localeCompare(String(b.accn ?? "")))) m.set(f.end, f.val);
    return [...m.entries()].map(([end, val]) => ({ end, val }));
  }
  return [];
}

async function main() {
  const snap = await loadSnapshot("sp500");
  if (!snap?.stocks?.length) throw new Error("sp500 snapshot missing — hydrate data/ first");
  let names = snap.stocks.filter((s) => s.marketCap > 0);
  if (ONLY.length) names = names.filter((s) => ONLY.includes(s.symbol));
  if (CAP) names = names.slice(0, CAP);
  console.log(`refresh-buybacks: ${names.length} S&P 500 names → companyfacts pulls`);

  let ok = 0, noData = 0;
  const built = await mapPool(names, 6, async (s): Promise<BuybackRow | null> => {
    const cik = await tickerToCik(s.symbol).catch(() => null);
    if (!cik) return null;
    const padded = String(cik).replace(/\D/g, "").padStart(10, "0");
    const res = await secFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`);
    if (!res) { noData++; return null; }
    const j: any = await res.json().catch(() => null);
    const gaap = j?.facts?.["us-gaap"]; const dei = j?.facts?.dei;
    if (!gaap) { noData++; return null; }

    const buyback = durFacts(gaap, ["PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfEquity"]);
    const bb = flowTtm(buyback);
    const divFlow = durFacts(gaap, ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends", "Dividends"]);
    const divPaid = flowTtm(divFlow);
    const cfo = annualFlow(durFacts(gaap, ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]));
    const capex = annualFlow(durFacts(gaap, ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"]));

    const dividendYield = typeof s.dividendYield === "number" && s.dividendYield >= 0 ? s.dividendYield : null;
    // nothing to show for a name with neither a buyback nor a dividend
    if (!bb && !dividendYield) return null;

    const buybackTtm = bb?.val ?? null;
    const buybackYield = buybackTtm != null && s.marketCap > 0 ? buybackTtm / s.marketCap : null;
    const totalYield = buybackYield != null || dividendYield != null ? (buybackYield ?? 0) + (dividendYield ?? 0) : null;

    // acceleration: latest de-cumulated quarter annualized vs the TTM run-rate (de-spiked so a bad
    // XBRL quarter can't manufacture a fake acceleration)
    const bbQ = despikeQuarters(quarterize(buyback));
    const ttm = ttmSum(bbQ);
    const buybackAccel = ttm && ttm.val > 0 && bbQ.length ? (bbQ[bbQ.length - 1].val * 4) / ttm.val : null;

    // payout ÷ FCF on a consistent ANNUAL basis (mixing TTM buyback with annual FCF would be apples/oranges)
    const bbAnnual = annualFlow(buyback)?.val ?? 0;
    const divAnnual = annualFlow(divFlow)?.val ?? 0;
    const fcf = cfo && capex ? cfo.val - capex.val : null;
    const payoutToFcf = fcf && fcf > 0 ? (bbAnnual + divAnnual) / fcf : null;

    const netShareChangePct = yoyChange(shareSeries(gaap, dei));

    const partial = {
      symbol: s.symbol, name: s.name, sector: s.sector || "—", marketCap: s.marketCap, price: s.price,
      buybackTtm: buybackTtm != null ? Math.round(buybackTtm) : null,
      buybackYield: buybackYield != null ? +buybackYield.toFixed(4) : null,
      dividendYield: dividendYield != null ? +dividendYield.toFixed(4) : null,
      totalYield: totalYield != null ? +totalYield.toFixed(4) : null,
      netShareChangePct: netShareChangePct != null ? +netShareChangePct.toFixed(4) : null,
      buybackAccel: buybackAccel != null ? +buybackAccel.toFixed(2) : null,
      payoutToFcf: payoutToFcf != null ? +payoutToFcf.toFixed(2) : null,
      asOf: bb?.asOf ?? null,
    };
    ok++;
    return { ...partial, badges: classifyBuyback(partial) };
  });

  const rows = built.filter((r): r is BuybackRow => !!r).sort((a, b) => (b.totalYield ?? -1) - (a.totalYield ?? -1));
  const data: BuybackData = {
    generatedAt: new Date().toISOString(),
    source: "S&P 500 capital-return from SEC XBRL companyfacts (repurchases, dividends, share count)",
    rows,
  };
  // GUARDED write. On 2026-07-15 this script overwrote 495 good rows with [] because SEC failed every
  // fetch that night — the board went blank and Confluence silently lost its buyback signal. A bad
  // night must degrade this feed to STALE, never to EMPTY. Blocked ⇒ exit non-zero so the tick logs ✗
  // and the freshness gate reports honestly, rather than "succeeding" with destroyed data.
  const w = await writeFeedGuarded(OUT, data);
  if (!w.written) {
    console.error(`refresh-buybacks: WRITE BLOCKED — ${w.reason}`);
    console.error(`  built only ${rows.length} rows from ${names.length} names (${ok} with data, ${noData} no companyfacts) — SEC almost certainly rate-limited/blocked this run.`);
    process.exit(1);
  }
  console.log(`wrote ${rows.length} rows (${ok} with data, ${noData} no companyfacts). [${w.reason}]`);
  const withBb = rows.filter((r) => r.buybackTtm);
  const shrinking = rows.filter((r) => r.badges.includes("shrinking"));
  console.log(`${withBb.length} active repurchasers · ${shrinking.length} genuinely shrinking the count`);
  console.log("top total-yield names:");
  for (const r of rows.slice(0, 8)) {
    const bY = r.buybackYield != null ? (r.buybackYield * 100).toFixed(1) : "—";
    const dY = r.dividendYield != null ? (r.dividendYield * 100).toFixed(1) : "—";
    const net = r.netShareChangePct != null ? (r.netShareChangePct * 100).toFixed(1) + "%" : "—";
    console.log(`  ${r.symbol.padEnd(6)} total ${((r.totalYield ?? 0) * 100).toFixed(1)}% (bb ${bY}% + div ${dY}%)  netΔshares ${net}  ${r.badges.join(",")}`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
