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
 *
 * ── STAGGERED FETCH (2026-07-15) ────────────────────────────────────────────────────────────────
 * Re-pulling all ~500 names nightly meant ~1.9 GB of companyfacts (3.75 MB each) to extract eight
 * numbers per company — which blew the tick's 45-min step cap on the NAS's home uplink every night,
 * so the step was killed and the feed rotted. SEC offers no way to avoid the payload: no ETag, no
 * Last-Modified, `Cache-Control: no-store` — a conditional GET returns the full body (verified).
 *
 * But the DATA is quarterly. A company's TTM repurchases only move when it files. So:
 *   • the SEC-derived facts are CACHED per symbol in data/buybacks-facts.json (internal state, like
 *     the ipo/spinoff screened ledgers — unregistered, rides to R2 in the nightly tarball),
 *   • each run refreshes only what's stale, oldest-first, under a wall-clock BUDGET — so the step
 *     finishes inside the cap BY CONSTRUCTION instead of being killed,
 *   • everything price-dependent (buyback yield, total yield) is RECOMPUTED EVERY RUN from today's
 *     snapshot market cap. Caching a *yield* would let it drift silently as the stock moves; only the
 *     filing-derived numerators are cached.
 * Cold cache → the board fills in over a few nights (the write-guard's bootstrap rule allows a
 * growing feed); warm cache → a night costs ~1/7th of the bandwidth.
 */
import { promises as fsp } from "fs";
import path from "path";
import { loadSnapshot } from "../lib/data";
import { tickerToCik } from "../lib/edgar";
import { writeFeedGuarded } from "../lib/feedGuard";
import { latestFilingEnds, isDueByFiling, cikKey, seenEndFromFacts } from "../lib/secFrames";
import {
  quarterize, despikeQuarters, ttmSum, yoyChange, classifyBuyback,
  type BuybackRow, type BuybackData, type DurFact, type InstFact,
} from "../lib/buybacks";

const OUT = "buybacks.json"; // written via the registry-backed guard (lib/feedGuard), not raw fs
const CACHE = path.join(process.cwd(), "data", "buybacks-facts.json");
// Committed bootstrap seed (public SEC facts, NOT gitignored) — the escape hatch from the deadlock
// where a zeroed board seeds an empty cache seeds a zeroed board. See the cold-start block below.
const SEED = path.join(process.cwd(), "data-seed", "buybacks-facts.seed.json");
const UA = "stock-chart-screener research jameslyeh@gmail.com";
const DAY = 86_400_000;
const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const ONLY = (process.env.ONLY || "").split(",").map((s) => s.trim().toUpperCase()).filter(Boolean);
const CAP = Number(process.env.CAP || 0); // optional: limit names (for a quick test run)
/** Wall-clock ceiling for SEC fetching. MUST stay under run-tick's STEP_TIMEOUT_MIN (45) — the whole
 *  point is that this step finishes on its own terms instead of being killed mid-flight. */
const BUDGET_MIN = Number(process.env.BUYBACK_BUDGET_MIN || 30);
/** Re-pull a name at most this often. Companyfacts only change when the company FILES (quarterly), so
 *  a weekly refresh is already far more often than the data can move. */
const MAX_AGE_DAYS = Number(process.env.BUYBACK_MAX_AGE_DAYS || 7);

/** The filing-derived half of a row — cacheable because it only changes when the company files.
 *  Deliberately EXCLUDES anything touching market cap (see the header: yields are recomputed nightly). */
interface CachedFacts {
  fetchedAt: string; // YYYY-MM-DD of the SEC pull
  buybackTtm: number | null;
  netShareChangePct: number | null;
  buybackAccel: number | null;
  payoutToFcf: number | null;
  asOf: string | null;
  /** Newest us-gaap/Assets end seen at pull time — pairs with the frames filing-detector so a name
   *  is only re-pulled when it has FILED something newer. Absent on pre-migration/seed entries
   *  (isDueByFiling falls back to asOf; the first pull stamps it). */
  seenEnd?: string | null;
}
interface FactsCache { generatedAt: string; bySymbol: Record<string, CachedFacts> }

const todayISO = () => new Date().toISOString().slice(0, 10);
const ageDays = (iso: string | undefined) => (iso ? Math.round((Date.now() - Date.parse(iso + "T00:00:00Z")) / DAY) : Infinity);

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

/** One SEC pull → the cacheable, filing-derived facts. Null when the name has no usable companyfacts. */
async function fetchFacts(symbol: string): Promise<CachedFacts | null> {
  const cik = await tickerToCik(symbol).catch(() => null);
  if (!cik) return null;
  const padded = String(cik).replace(/\D/g, "").padStart(10, "0");
  const res = await secFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`);
  if (!res) return null;
  const j: any = await res.json().catch(() => null);
  const gaap = j?.facts?.["us-gaap"]; const dei = j?.facts?.dei;
  if (!gaap) return null;

  const buyback = durFacts(gaap, ["PaymentsForRepurchaseOfCommonStock", "PaymentsForRepurchaseOfEquity"]);
  const bb = flowTtm(buyback);
  const divFlow = durFacts(gaap, ["PaymentsOfDividendsCommonStock", "PaymentsOfDividends", "Dividends"]);
  const cfo = annualFlow(durFacts(gaap, ["NetCashProvidedByUsedInOperatingActivities", "NetCashProvidedByUsedInOperatingActivitiesContinuingOperations"]));
  const capex = annualFlow(durFacts(gaap, ["PaymentsToAcquirePropertyPlantAndEquipment", "PaymentsToAcquireProductiveAssets"]));

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

  return {
    fetchedAt: todayISO(),
    buybackTtm: bb ? Math.round(bb.val) : null,
    netShareChangePct: netShareChangePct != null ? +netShareChangePct.toFixed(4) : null,
    buybackAccel: buybackAccel != null ? +buybackAccel.toFixed(2) : null,
    payoutToFcf: payoutToFcf != null ? +payoutToFcf.toFixed(2) : null,
    asOf: bb?.asOf ?? null,
    seenEnd: seenEndFromFacts(j),
  };
}

/** Cached filing facts × TODAY's snapshot → the board row. The yields live here, not in the cache:
 *  buyback yield moves with market cap every day even when the filing behind it hasn't changed. */
function buildRow(s: any, f: CachedFacts): BuybackRow | null {
  const dividendYield = typeof s.dividendYield === "number" && s.dividendYield >= 0 ? s.dividendYield : null;
  // nothing to show for a name with neither a buyback nor a dividend
  if (f.buybackTtm == null && dividendYield == null) return null;
  const buybackYield = f.buybackTtm != null && s.marketCap > 0 ? f.buybackTtm / s.marketCap : null;
  const totalYield = buybackYield != null || dividendYield != null ? (buybackYield ?? 0) + (dividendYield ?? 0) : null;
  const partial = {
    symbol: s.symbol, name: s.name, sector: s.sector || "—", marketCap: s.marketCap, price: s.price,
    buybackTtm: f.buybackTtm,
    buybackYield: buybackYield != null ? +buybackYield.toFixed(4) : null,
    dividendYield: dividendYield != null ? +dividendYield.toFixed(4) : null,
    totalYield: totalYield != null ? +totalYield.toFixed(4) : null,
    netShareChangePct: f.netShareChangePct,
    buybackAccel: f.buybackAccel,
    payoutToFcf: f.payoutToFcf,
    asOf: f.asOf,
  };
  return { ...partial, badges: classifyBuyback(partial) };
}

async function main() {
  const snap = await loadSnapshot("sp500");
  if (!snap?.stocks?.length) throw new Error("sp500 snapshot missing — hydrate data/ first");
  let names = snap.stocks.filter((s) => s.marketCap > 0);
  if (ONLY.length) names = names.filter((s) => ONLY.includes(s.symbol));
  if (CAP) names = names.slice(0, CAP);

  const cache: FactsCache = await fsp.readFile(CACHE, "utf8").then((s) => JSON.parse(s)).catch(() => ({ generatedAt: "", bySymbol: {} }));
  cache.bySymbol ??= {};

  // Seed a cold cache from the existing board — every cached field is already a column there, so a
  // healthy buybacks.json warms the cache instantly instead of paying for a week of re-fetching.
  let seeded = 0;
  if (!Object.keys(cache.bySymbol).length) {
    const prior: { rows?: BuybackRow[] } = await fsp.readFile(path.join(process.cwd(), "data", OUT), "utf8").then((s) => JSON.parse(s)).catch(() => ({}));
    for (const r of prior.rows ?? []) {
      if (!r?.symbol) continue;
      // Dated to the filing period, NOT today: seeded names are still due for a real pull, just not
      // all at once — they queue behind anything genuinely never-fetched.
      cache.bySymbol[r.symbol] = { fetchedAt: (r.asOf ?? "1970-01-01").slice(0, 10), buybackTtm: r.buybackTtm, netShareChangePct: r.netShareChangePct, buybackAccel: r.buybackAccel, payoutToFcf: r.payoutToFcf, asOf: r.asOf };
      seeded++;
    }
    if (seeded) console.log(`refresh-buybacks: seeded ${seeded} names from the existing board (no re-fetch needed to render)`);
  }

  // Last-resort BOOTSTRAP — both the cache AND the board are empty. That's a fresh clone, OR the
  // deadlock the 2026-07-15 incident created: the board was zeroed, so seeding the cache from the
  // board yields nothing, so the only way to render is live SEC fetches — and on the NAS's uplink
  // data.sec.gov is unreachable, so it wrote 0 rows every night forever. The committed seed of public
  // SEC facts breaks that loop: the board renders real (if aging) rows immediately and degrades to
  // STALE, never EMPTY; the budgeted nightly refresh supersedes it oldest-first as SEC permits.
  if (!Object.keys(cache.bySymbol).length) {
    const seed: FactsCache = await fsp.readFile(SEED, "utf8").then((s) => JSON.parse(s)).catch(() => ({ generatedAt: "", bySymbol: {} }));
    for (const [sym, f] of Object.entries(seed.bySymbol ?? {})) cache.bySymbol[sym] = f;
    const n = Object.keys(cache.bySymbol).length;
    if (n) console.log(`refresh-buybacks: COLD BOOTSTRAP — seeded ${n} names from data-seed/${path.basename(SEED)} (board + cache both empty)`);
    else console.warn("refresh-buybacks: board, cache, AND seed all empty — the board can only fill from live SEC pulls this run.");
  }

  // ── Filing detector (SEC frames) ─────────────────────────────────────────────────────────────
  // Companyfacts only change when the company FILES, and the frames API tells us who filed in a
  // handful of requests — so instead of re-pulling everything older than 7 days (~70 names ×
  // 3.75 MB a night), pull only the names whose newest filed period-end moved (~a dozen a night,
  // plus a monthly restatement ceiling). On the NAS's slow SEC path this is the difference between
  // a step that fits its budget and one that dies. FRAMES=0 disables; a detector FAILURE (null)
  // must fall back to the blanket age rule — "detector down" must never read as "nothing filed".
  const now = Date.now();
  const useFrames = process.env.FRAMES !== "0";
  const filed = useFrames ? await latestFilingEnds(now).catch(() => null) : null;
  if (useFrames && !filed) console.warn("refresh-buybacks: ⚠ frames filing-detector unavailable — falling back to blanket age-based staleness");
  const frameEndBySym = new Map<string, string | undefined>();
  if (filed) {
    for (const s of names) {
      const cik = await tickerToCik(s.symbol).catch(() => null); // cached map lookup — cheap
      frameEndBySym.set(s.symbol, cik ? filed.get(cikKey(cik)) : undefined);
    }
  }

  // Fresh FILINGS first (new data provably exists), then oldest-first — so on a budget-capped
  // night the synchronized restatement-ceiling cohort can't starve names that actually filed.
  const filedDue = (s: { symbol: string }): number => {
    const c = cache.bySymbol[s.symbol];
    const fEnd = frameEndBySym.get(s.symbol);
    return !c || (fEnd && fEnd > (c.seenEnd ?? c.asOf ?? "")) ? 1 : 0;
  };
  const due = names
    .filter((s) => (filed
      ? isDueByFiling(cache.bySymbol[s.symbol], frameEndBySym.get(s.symbol), now)
      : ageDays(cache.bySymbol[s.symbol]?.fetchedAt) >= MAX_AGE_DAYS))
    .sort((a, b) => {
      const d = filedDue(b) - filedDue(a);
      if (d) return d;
      return ageDays(cache.bySymbol[b.symbol]?.fetchedAt) - ageDays(cache.bySymbol[a.symbol]?.fetchedAt);
    });
  console.log(
    `refresh-buybacks: ${names.length} names · ${Object.keys(cache.bySymbol).length} cached · ${due.length} due ` +
    `(${filed ? `filing-detector, ${filed.size} filers visible` : `blanket >${MAX_AGE_DAYS}d`}) · budget ${BUDGET_MIN}min`,
  );

  // BUDGETED pull: stop when the clock runs out, not when SEC does. The step finishing on its own
  // terms is the whole fix — a killed step wrote nothing and rotted the feed.
  // Anchored to `now` (captured BEFORE the frames detector), so a slow/hanging detector eats into
  // the budget instead of extending the step past it — the whole step must fit run-tick's 45-min cap.
  const deadline = now + BUDGET_MIN * 60_000;
  let fetched = 0, noData = 0, budgetHit = false;
  await mapPool(due, 6, async (s) => {
    if (Date.now() > deadline) { budgetHit = true; return; }
    const f = await fetchFacts(s.symbol);
    if (!f) { noData++; return; }
    cache.bySymbol[s.symbol] = f;
    fetched++;
  });
  const left = due.length - fetched - noData;
  console.log(`refresh-buybacks: fetched ${fetched} (${noData} no companyfacts)${budgetHit ? ` · BUDGET SPENT — ${left} names deferred to the next run` : " · all due names refreshed"}`);

  // Build EVERY name we have facts for — cached or just-fetched — against today's prices.
  const rows = names
    .map((s) => { const f = cache.bySymbol[s.symbol]; return f ? buildRow(s, f) : null; })
    .filter((r): r is BuybackRow => !!r)
    .sort((a, b) => (b.totalYield ?? -1) - (a.totalYield ?? -1));
  const ok = rows.length;
  const data: BuybackData = {
    generatedAt: new Date().toISOString(),
    source: "S&P 500 capital-return from SEC XBRL companyfacts (repurchases, dividends, share count)",
    rows,
  };
  // GUARDED write. On 2026-07-15 this script overwrote 495 good rows with [] because SEC failed every
  // fetch that night — the board went blank and Confluence silently lost its buyback signal. A bad
  // night must degrade this feed to STALE, never to EMPTY. Blocked ⇒ exit non-zero so the tick logs ✗
  // and the freshness gate reports honestly, rather than "succeeding" with destroyed data.
  // Persist the cache FIRST — this run's SEC work must survive even if the board write is blocked,
  // otherwise a blocked night would re-pay the whole bandwidth bill tomorrow for nothing.
  await fsp.writeFile(CACHE, JSON.stringify({ generatedAt: new Date().toISOString(), bySymbol: cache.bySymbol } satisfies FactsCache));

  const w = await writeFeedGuarded(OUT, data);
  if (!w.written) {
    console.error(`refresh-buybacks: WRITE BLOCKED — ${w.reason}`);
    console.error(`  built only ${rows.length} rows from ${names.length} names — the fact cache holds ${Object.keys(cache.bySymbol).length}; it will fill in on the next runs.`);
    process.exit(1);
  }
  console.log(`wrote ${rows.length} rows (${ok} priced from ${Object.keys(cache.bySymbol).length} cached names). [${w.reason}]`);
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
