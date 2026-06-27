/**
 * Builds data/valuation-history.json — the "Discount to own 10-year history" screen.
 *
 * For each US name (EDGAR-covered), rebuild a point-in-time valuation-multiple series and
 * compare today's multiple to the name's OWN trailing-10yr median. The hard parts:
 *
 *   1) Fundamentals come from SEC EDGAR quarterly companyfacts (getEdgarQuarterly), back to
 *      ~2007. Income/CF items are YTD-diffed to discrete quarters by the lib; balance items are
 *      instants. We add short-term debt + a basic-shares fallback via a direct companyfacts pull.
 *
 *   2) ** SPLIT ALIGNMENT (the headline finding) ** — EDGAR shares/EPS are AS-REPORTED (pre-split);
 *      the chart close is adjusted-to-today. So we build a cumulative split factor F(t) = product of
 *      split ratios dated AFTER quarter-end t, and put reported shares onto today's basis:
 *      adjShares = reportedShares / F(t). Then mcap = adjClose × adjShares is internally consistent.
 *      Validation anchor: AAPL (4:1 split Aug-2020) 2015 P/E must be ~14-15, NOT ~3.8.
 *
 *   3) Per multiple we keep the trailing 40 quarters, drop non-positive-denominator points (pe,
 *      evEbitda are positive-only), winsorize tails, and require ≥8 valid points or OMIT the
 *      multiple. Stats use the MEDIAN, not the mean.
 *
 *   4) Sector eligibility: financials → P/B + P/E only (EV/EBITDA and P/S are junk for banks).
 *      Non-financials → pe, evEbitda, ps, pb. Thin-GAAP names (lots of negative/garbage P/E) →
 *      suppress P/E, lean on P/S.
 *
 *   npx tsx scripts/refresh-valuation-history.ts            # all US universes
 *   npx tsx scripts/refresh-valuation-history.ts AAPL MSFT  # specific tickers (test, no write)
 *   npx tsx scripts/refresh-valuation-history.ts --only=sp500   # one universe, write the file
 */
import { promises as fs } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { UNIVERSES } from "../lib/universes";
import { tickerToCik } from "../lib/edgar";
import { getEdgarQuarterly } from "../lib/edgarFinancials";
import type { Snapshot } from "../lib/types";
import type {
  MultipleKey,
  MultipleStat,
  SectorClass,
  ValuationHistoryData,
  ValuationName,
} from "../lib/valuationHistory";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA_DIR = path.join(process.cwd(), "data");
const UA = "stock-chart-screener research jameslyeh@gmail.com";
const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ---- global SEC rate limiter ----------
// data.sec.gov throttles >10 req/s with a 429 (and the throttle lingers). We funnel EVERY SEC
// fetch through a token bucket (~7 req/s) + retry-with-backoff so a 500-name run doesn't trip it.
let _secNextSlot = 0;
const SEC_INTERVAL = 145; // ms between SEC requests (~7/s)
async function secThrottle() {
  const now = Date.now();
  const slot = Math.max(now, _secNextSlot);
  _secNextSlot = slot + SEC_INTERVAL;
  if (slot > now) await sleep(slot - now);
}

/** Rate-limited SEC fetch with retry on 429/403/5xx (exponential backoff). Returns null on give-up. */
async function secFetch(url: string): Promise<Response | null> {
  for (let attempt = 0; attempt < 5; attempt++) {
    await secThrottle();
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store" });
      if (res.ok) return res;
      if (res.status === 429 || res.status === 403 || res.status >= 500) {
        await sleep(800 * Math.pow(2, attempt) + Math.random() * 400); // 0.8s,1.6s,3.2s,6.4s…
        continue;
      }
      return res; // 404 etc. — don't retry
    } catch {
      await sleep(800 * Math.pow(2, attempt));
    }
  }
  return null;
}

async function mapPool<T, R>(items: T[], size: number, fn: (x: T, i: number) => Promise<R>): Promise<R[]> {
  const ret = new Array<R>(items.length);
  let idx = 0;
  async function worker() {
    for (;;) {
      const i = idx++;
      if (i >= items.length) return;
      ret[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, worker));
  return ret;
}

// ---- direct companyfacts pull for concepts getEdgarQuarterly doesn't tag ----------
const STD_CONCEPTS = ["LongTermDebtCurrent", "DebtCurrent", "ShortTermBorrowings", "CommercialPaper"];
const BASIC_SHARE_CONCEPTS = ["WeightedAverageNumberOfSharesOutstandingBasic"];

interface Supplement {
  shortTermDebt: Map<string, number>; // period-end → value (instant)
  basicShares: Map<string, number>; // period-end → value (duration, ~quarter span)
}

const span = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** latest-filing-wins instant map for a balance-sheet concept */
function instMap(facts: any[], into: Map<string, number>) {
  for (const f of [...facts].sort((a, b) => String(a.accn).localeCompare(String(b.accn)))) {
    if (f.end == null || typeof f.val !== "number") continue;
    into.set(f.end, f.val);
  }
}

/** ~one-quarter-span duration map (latest filing wins) for the basic-shares fallback */
function quarterDurMap(facts: any[], into: Map<string, number>) {
  for (const f of [...facts].sort((a, b) => String(a.accn).localeCompare(String(b.accn)))) {
    if (f.start == null || f.end == null || typeof f.val !== "number") continue;
    const sp = span(f.start, f.end);
    if (sp >= 78 && sp <= 100) into.set(f.end, f.val);
  }
}

async function fetchSupplement(cik: string): Promise<Supplement> {
  const out: Supplement = { shortTermDebt: new Map(), basicShares: new Map() };
  try {
    const padded = cik.replace(/\D/g, "").padStart(10, "0");
    const res = await secFetch(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`);
    if (!res || !res.ok) return out;
    const j: any = await res.json();
    const gaap = j?.facts?.["us-gaap"];
    if (!gaap) return out;
    // short-term debt: take the FIRST concept that has data per period-end (don't sum — these
    // overlap; LongTermDebtCurrent is the cleanest, then fall back to the others).
    for (const c of STD_CONCEPTS) {
      const arr = gaap[c]?.units?.USD;
      if (Array.isArray(arr) && arr.length) {
        const m = new Map<string, number>();
        instMap(arr, m);
        for (const [k, v] of m) if (!out.shortTermDebt.has(k)) out.shortTermDebt.set(k, v);
      }
    }
    for (const c of BASIC_SHARE_CONCEPTS) {
      const arr = gaap[c]?.units?.shares;
      if (Array.isArray(arr) && arr.length) quarterDurMap(arr, out.basicShares);
    }
  } catch {
    /* leave empty */
  }
  return out;
}

// ---- price history + splits ----------
interface PricePoint { t: number; c: number }
interface Split { t: number; ratio: number }

async function fetchPrices(symbol: string): Promise<{ quotes: PricePoint[]; splits: Split[] }> {
  try {
    const ch: any = await yf.chart(
      symbol,
      { period1: new Date("2015-01-01"), interval: "1d", events: "split" } as any,
      { validateResult: false },
    );
    const quotes: PricePoint[] = (ch?.quotes || [])
      .filter((q: any) => q?.date && q.close != null)
      .map((q: any) => ({ t: new Date(q.date).getTime(), c: q.close as number }))
      .sort((a: PricePoint, b: PricePoint) => a.t - b.t);
    const ev = ch?.events?.splits;
    const arr: any[] = Array.isArray(ev) ? ev : ev ? Object.values(ev) : [];
    const splits: Split[] = arr
      .map((s) => ({ t: new Date(s.date).getTime(), ratio: s.numerator && s.denominator ? s.numerator / s.denominator : 0 }))
      .filter((s) => Number.isFinite(s.t) && s.ratio > 0 && Math.abs(s.ratio - 1) > 1e-6);
    return { quotes, splits };
  } catch {
    return { quotes: [], splits: [] };
  }
}

/** cumulative split factor F(t) = product of split ratios dated AFTER quarter-end t.
 *  The chart close is adjusted to TODAY (post-split); EDGAR shares are as-reported (pre-split).
 *  A 4:1 split quadruples the share count, so to put as-reported shares onto today's basis we
 *  MULTIPLY by F (adjShares = reportedShares × F) — equivalently divide reported EPS by F. This is
 *  the headline split fix: the AAPL 4:1 (Aug-2020) makes its 2015 P/E come out ~14, not ~0.9. */
function splitFactor(quarterEndMs: number, splits: Split[]): number {
  let f = 1;
  for (const s of splits) if (s.t > quarterEndMs) f *= s.ratio;
  return f;
}

/** last daily close AT or AFTER the period-end (binary search; carry-forward to the latest close). */
function closeAtOrAfter(quotes: PricePoint[], periodEndMs: number): number | null {
  if (!quotes.length) return null;
  if (periodEndMs <= quotes[0].t) return quotes[0].c;
  if (periodEndMs > quotes[quotes.length - 1].t) {
    // beyond the series — only carry forward if it's recent (≤30d past the last close), else stale.
    return periodEndMs - quotes[quotes.length - 1].t <= 30 * DAY ? quotes[quotes.length - 1].c : null;
  }
  let lo = 0, hi = quotes.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (quotes[mid].t >= periodEndMs) hi = mid;
    else lo = mid + 1;
  }
  return quotes[lo].c;
}

// ---- stats helpers ----------
const num = (x: any): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const round2 = (x: number) => Math.round(x * 100) / 100;

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2;
}
function quantile(sorted: number[], p: number): number {
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round(p * (sorted.length - 1))));
  return sorted[i];
}

/** Winsorize the tails at the 5th/95th percentile so a single garbage quarter (a near-zero
 *  denominator multiple) doesn't blow out the median/stdev. Operates in place on a copy. */
function winsorize(xs: number[]): number[] {
  if (xs.length < 5) return xs;
  const s = [...xs].sort((a, b) => a - b);
  const lo = quantile(s, 0.05), hi = quantile(s, 0.95);
  return xs.map((v) => Math.min(hi, Math.max(lo, v)));
}

interface MultiplePoint { ym: string; pe: number | null; evEbitda: number | null; ps: number | null; pb: number | null }

// Sane band for the CURRENT (most-recent-quarter) multiple. The median is winsorized, but a raw
// current point explodes when its denominator goes near-zero (e.g. INTC P/E 6392 at ~0 TTM NI, IRM
// P/B 1258 at ~0 equity, COHR EV/EBITDA 0.03 at ~0 EBITDA, LNT P/S 143 from a units glitch). A
// current value outside its band is unpublishable garbage → suppress the whole multiple for the
// name, so it never drives a bogus discount/premium. Bands are deliberately wide (real rerates like
// AMZN/PYPL/UNH stay well inside).
const CURRENT_BAND: Record<MultipleKey, [number, number]> = {
  pe: [2, 150],
  evEbitda: [2, 80],
  ps: [0.05, 40],
  pb: [0.2, 40],
};

/** Build the MultipleStat for one key from the trailing series, or null if insufficient or if the
 *  CURRENT (latest) value is unhealthy/out-of-band (see CURRENT_BAND). */
function buildStat(points: MultiplePoint[], key: MultipleKey, positiveOnly: boolean): MultipleStat | null {
  // The current point must come from the MOST-RECENT quarter (points is oldest→newest). If that
  // quarter's denominator is unhealthy (null, or non-positive for pe/evEbitda/ps/pb), the multiple
  // is meaningless right now → suppress, rather than silently publishing an older stale quarter as
  // "current". (A name with a transient loss correctly drops out until it's profitable again.)
  const latest = points[points.length - 1]?.[key];
  if (latest == null || !Number.isFinite(latest) || latest <= 0) return null;
  const [bandLo, bandHi] = CURRENT_BAND[key];
  if (latest < bandLo || latest > bandHi) return null;

  // keep (ym, value) for valid points only
  const raw: [string, number][] = [];
  for (const p of points) {
    const v = p[key];
    if (v == null || !Number.isFinite(v)) continue;
    if (positiveOnly && v <= 0) continue;
    raw.push([p.ym, v]);
  }
  // trailing 40 quarters (the series is oldest→newest; take the last 40)
  const trail = raw.slice(-40);
  if (trail.length < 8) return null;
  // current = the latest quarter's value (guaranteed present + in-band by the guard above)
  const current = latest;
  const vals = winsorize(trail.map(([, v]) => v));
  const sorted = [...vals].sort((a, b) => a - b);
  const med = median(vals);
  const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
  const variance = vals.reduce((a, b) => a + (b - mean) * (b - mean), 0) / vals.length;
  const stdev = Math.sqrt(variance);
  const z = stdev > 0 ? (current - med) / stdev : 0;

  // FINAL sanity gate on the CURRENT value vs the name's OWN (robust, winsorized) history. Some
  // YTD-diff corruption leaves a single quarter wrong-signed-but-in-magnitude, so the multiple lands
  // inside CURRENT_BAND yet is still garbage (OMC P/E 142 = 11× its median at z≈50; FIX P/S 8 ≈ 9× at
  // z≈6). A GENUINE rerate never strays this far: the deepest real moves here (PYPL, AMZN, CRM) sit at
  // |z| ≲ 3 and within ~5× their median. So suppress when |z| > 6 or current is beyond 8×/⅛ the
  // median — that kills the in-band data artifacts while leaving every real rerate untouched.
  if (med > 0 && (Math.abs(z) > 6 || current > med * 8 || current < med / 8)) return null;

  return {
    current: round2(current),
    median: round2(med),
    p25: round2(quantile(sorted, 0.25)),
    p75: round2(quantile(sorted, 0.75)),
    discountPct: med !== 0 ? Math.round((current / med - 1) * 100) : 0,
    z: Math.round(z * 100) / 100,
    n: trail.length,
    series: trail.map(([ym, v]) => [ym, round2(v)] as [string, number]),
  };
}

interface SnapMeta { sector: string; etf: string }

function classifySector(meta: SnapMeta | undefined): SectorClass {
  const sec = (meta?.sector || "").toLowerCase();
  const etf = (meta?.etf || "").toUpperCase();
  if (etf === "XLF" || /financ|bank|insurance/.test(sec)) return "financial";
  return "non-financial";
}

// Dual-class tickers whose EDGAR weighted-share count is reported on a DIFFERENT class than the
// price series we fetch (e.g. Berkshire reports A-share-equivalent shares, but BRK-B trades at
// 1/1500 of an A share) — every multiple comes out ~1500× off. The CURRENT_BAND guard already
// catches the resulting garbage, but exclude them outright so we never publish a tiny in-band fluke.
const DUAL_CLASS_EXCLUDE = new Set(["BRK-B", "BRK.B", "BRK-A", "BRK.A", "BF-B", "BF.B", "BF-A", "BF.A"]);

/** Compute a name's full ValuationName, or null if we can't build anything usable. */
async function computeName(symbol: string, meta: SnapMeta | undefined): Promise<ValuationName | null> {
  if (DUAL_CLASS_EXCLUDE.has(symbol.toUpperCase())) return null;
  const cik = await tickerToCik(symbol);
  if (!cik) return null; // non-US → skip

  // getEdgarQuarterly does its OWN companyfacts pull (unthrottled, no retry, returns [] on a 429).
  // Gate it through the SEC throttle and retry with backoff so a 500-name run doesn't silently lose
  // every name once SEC starts rate-limiting (the failure that capped the first sp500 run at ~97).
  const fetchQuarters = async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      await secThrottle();
      const q = await getEdgarQuarterly(symbol);
      if (q.length) return q;
      await sleep(800 * Math.pow(2, attempt) + Math.random() * 400);
    }
    return [];
  };
  const [periods, supplement, prices] = await Promise.all([
    fetchQuarters(),
    fetchSupplement(cik),
    fetchPrices(symbol),
  ]);
  if (!periods.length || prices.quotes.length < 60) return null;

  // sort quarters oldest→newest by date, dedup near-duplicate ends (<25 days apart)
  const sorted = [...periods].sort((a, b) => a.date.localeCompare(b.date));
  const quarters: typeof sorted = [];
  for (const p of sorted) {
    const prev = quarters[quarters.length - 1];
    if (prev && Math.abs(span(prev.date, p.date)) < 25) {
      quarters[quarters.length - 1] = p; // keep the later filing for a near-dup end
    } else {
      quarters.push(p);
    }
  }

  // Clean per-quarter weighted-share counts, on the SPLIT-ADJUSTED basis. Two corruptions to fix:
  //  (1) getEdgarQuarterly YTD-diffs duration concepts, but weighted-AVERAGE shares aren't additive
  //      across a fiscal year, so a derived quarter can come out negative or implausibly tiny (e.g.
  //      AMZN 2025-Q4 = 12M vs ~10.8B neighbours).
  //  (2) Splits: as-reported counts jump at a split (AMZN 481M → 10.2B at the 2022 20:1), so a median
  //      over the raw as-reported series mixes the two regimes and wrongly flags whole post-split eras
  //      as outliers. So we FIRST put every quarter on today's basis (×F), THEN clean: a single smooth
  //      series whose median + outlier guard are meaningful. Replace garbage with the nearest valid
  //      neighbour — share count drifts slowly, so a carry-across beats a garbage quarter.
  const shareByDate = new Map<string, number>(); // date → split-ADJUSTED shares (today's basis)
  {
    const cand: { date: string; v: number | null }[] = quarters.map((q) => {
      let s = num(q.dilutedAverageShares);
      if (s == null || s <= 0) s = supplement.basicShares.get(q.date) ?? null;
      if (s == null || s <= 0) return { date: q.date, v: null };
      const F = splitFactor(Date.parse(q.date + "T00:00:00Z"), prices.splits);
      return { date: q.date, v: s * F }; // adjusted to today's share basis
    });
    const pos = cand.map((c) => c.v).filter((v): v is number => v != null).sort((a, b) => a - b);
    const med = pos.length ? pos[Math.floor(pos.length / 2)] : 0;
    const valid = (v: number | null): v is number => v != null && (med <= 0 || (v <= med * 3 && v >= med / 3));
    for (let i = 0; i < cand.length; i++) {
      if (valid(cand[i].v)) {
        shareByDate.set(cand[i].date, cand[i].v!);
        continue;
      }
      // nearest valid neighbour (search outward) — already on the adjusted basis, so safe to carry
      let chosen: number | null = null;
      for (let d = 1; d < cand.length && chosen == null; d++) {
        if (i - d >= 0 && valid(cand[i - d].v)) chosen = cand[i - d].v!;
        else if (i + d < cand.length && valid(cand[i + d].v)) chosen = cand[i + d].v!;
      }
      if (chosen != null) shareByDate.set(cand[i].date, chosen);
    }
  }

  // Clean per-quarter INCOME-STATEMENT items the same way as shares. getEdgarQuarterly's YTD-diff
  // also corrupts the occasional Q4 flow value — a NEGATIVE revenue (FIX 2025-Q4 rev = −$4.6B) or a
  // wildly-off netIncome (OMC 2025-Q4 NI = −$898M) — which then poisons the TTM that drives the
  // CURRENT multiple (FIX P/S 17, OMC P/E 142). The CURRENT_BAND can't see these (the resulting
  // multiple lands in-band), so we must fix the inputs: reject a quarter whose value has the wrong
  // sign or is a gross magnitude outlier vs the name's own history, and carry the nearest valid
  // neighbour. Revenue must be > 0; for signed flows (NI/OI/D&A) we judge by |value| vs median |value|.
  const cleanFlow = (field: string, mustBePositive: boolean): Map<string, number> => {
    const out = new Map<string, number>();
    const cand = quarters.map((q) => ({ date: q.date, v: num(q[field]) }));
    const mags = cand.map((c) => c.v).filter((v): v is number => v != null && (!mustBePositive || v > 0)).map((v) => Math.abs(v)).sort((a, b) => a - b);
    const medMag = mags.length ? mags[Math.floor(mags.length / 2)] : 0;
    const valid = (v: number | null): v is number =>
      v != null && (!mustBePositive || v > 0) && (medMag <= 0 || Math.abs(v) <= medMag * 3.5);
    for (let i = 0; i < cand.length; i++) {
      if (valid(cand[i].v)) { out.set(cand[i].date, cand[i].v!); continue; }
      let chosen: number | null = null;
      for (let d = 1; d < cand.length && chosen == null; d++) {
        if (i - d >= 0 && valid(cand[i - d].v)) chosen = cand[i - d].v!;
        else if (i + d < cand.length && valid(cand[i + d].v)) chosen = cand[i + d].v!;
      }
      if (chosen != null) out.set(cand[i].date, chosen);
    }
    return out;
  };
  const revByDate = cleanFlow("totalRevenue", true);
  const niByDate = cleanFlow("netIncome", false);
  const oiByDate = cleanFlow("operatingIncome", false);
  const daByDate = cleanFlow("depreciationAndAmortization", false);

  // We only need quarters with a price (period-end at/after 2015) — but compute TTM sums from the
  // full quarter list (TTM needs the prior 3 quarters which may predate 2015).
  const points: MultiplePoint[] = [];
  for (let i = 0; i < quarters.length; i++) {
    const q = quarters[i];
    const endMs = Date.parse(q.date + "T00:00:00Z");
    if (!Number.isFinite(endMs)) continue;

    // TTM sums over this + the prior 3 quarters (need all 4 present and contiguous-ish)
    if (i < 3) continue;
    const window = [quarters[i - 3], quarters[i - 2], quarters[i - 1], q];
    // require the window to roughly span a year (270–460 days end-to-end)
    const windowSpan = span(window[0].date, q.date);
    if (windowSpan < 270 || windowSpan > 460) continue;

    let ttmRev = 0, ttmNI = 0, ttmEbitda = 0;
    let revOk = true, niOk = true, ebitdaOk = true;
    for (const w of window) {
      const rev = revByDate.get(w.date) ?? null;
      const ni = niByDate.get(w.date) ?? null;
      const oi = oiByDate.get(w.date) ?? null;
      const da = daByDate.get(w.date) ?? null; // D&A may legitimately be absent — treated as 0 below
      if (rev == null) revOk = false; else ttmRev += rev;
      if (ni == null) niOk = false; else ttmNI += ni;
      if (oi == null) ebitdaOk = false; else ttmEbitda += oi + (da ?? 0);
    }

    // point-in-time balance items (this quarter)
    const ltd = num(q.longTermDebt) ?? 0;
    const std = supplement.shortTermDebt.get(q.date) ?? 0;
    const totalDebt = ltd + std;
    const cash = num(q.cashAndCashEquivalents) ?? 0;
    const equity = num(q.stockholdersEquity);
    // shareByDate is ALREADY split-adjusted to today's basis (see the cleaning block above), so it
    // pairs directly with the adjusted-to-today chart close — no second × F here.
    const adjShares = shareByDate.get(q.date) ?? null;
    if (adjShares == null || adjShares <= 0) continue;

    // price at/after the quarter-end (adjusted-to-today close); mcap is internally consistent.
    const adjClose = closeAtOrAfter(prices.quotes, endMs);
    if (adjClose == null) continue;
    const mcap = adjClose * adjShares;
    const ev = mcap + totalDebt - cash;

    const ym = q.date.slice(0, 7);
    // Emit the raw multiple (incl. negative P/E) — buildStat drops non-positive denominators for
    // pe/evEbitda, and the thin-GAAP detector needs to SEE the negative/garbage P/Es to count them.
    points.push({
      ym,
      pe: niOk && ttmNI !== 0 ? mcap / ttmNI : null,
      evEbitda: ebitdaOk && ttmEbitda !== 0 ? ev / ttmEbitda : null,
      ps: revOk && ttmRev > 0 ? mcap / ttmRev : null,
      pb: equity != null && equity > 0 ? mcap / equity : null,
    });
  }

  if (points.length < 8) return null;

  const sectorClass = classifySector(meta);

  // candidate multiples by sector (financials: P/B + P/E only)
  const candidates: MultipleKey[] = sectorClass === "financial" ? ["pe", "pb"] : ["pe", "evEbitda", "ps", "pb"];

  // Thin-GAAP detection on the trailing-40 P/E window: count quarters whose P/E is negative or
  // absurd (>100). If >40% of the in-window P/E quarters are garbage, suppress P/E.
  const peTrail = points.slice(-40).map((p) => p.pe);
  const peDefined = peTrail.filter((v): v is number => v != null);
  const peGarbage = peDefined.filter((v) => v < 0 || v > 100).length;
  const suppressPe = peDefined.length === 0 || (peDefined.length > 0 && peGarbage / peDefined.length > 0.4);

  const multiples: Partial<Record<MultipleKey, MultipleStat>> = {};
  const eligible: MultipleKey[] = [];
  for (const key of candidates) {
    if (key === "pe" && suppressPe) continue;
    const positiveOnly = key === "pe" || key === "evEbitda";
    const stat = buildStat(points, key, positiveOnly);
    if (stat) {
      multiples[key] = stat;
      eligible.push(key);
    }
  }
  if (!eligible.length) return null;

  const asOf = quarters[quarters.length - 1].date;
  return { asOf, sectorClass, eligible, multiples };
}

// ---- driver ----------
async function loadSnapMeta(): Promise<{ usSymbols: string[]; meta: Map<string, SnapMeta> }> {
  const meta = new Map<string, SnapMeta>();
  const order: string[] = [];
  const seen = new Set<string>();
  // US universes only (broadest first so sub-universe dups are skipped). russell3000 is the superset.
  const US = ["russell3000", "sp1500", "russell1000", "sp500", "nasdaq100"];
  const usIds = UNIVERSES.filter((u) => !u.international).map((u) => u.id);
  const ordered = [...US.filter((id) => usIds.includes(id)), ...usIds.filter((id) => !US.includes(id))];
  for (const id of ordered) {
    let snap: Snapshot | null = null;
    try {
      snap = JSON.parse(await fs.readFile(path.join(DATA_DIR, id, "snapshot.json"), "utf8")) as Snapshot;
    } catch {
      continue;
    }
    for (const st of snap.stocks) {
      if (!meta.has(st.symbol)) meta.set(st.symbol, { sector: st.sector, etf: st.etf });
      if (!seen.has(st.symbol)) {
        seen.add(st.symbol);
        order.push(st.symbol);
      }
    }
  }
  return { usSymbols: order, meta };
}

function coverageSummary(names: Record<string, ValuationName>) {
  const counts: Record<MultipleKey, number> = { pe: 0, evEbitda: 0, ps: 0, pb: 0 };
  let financial = 0;
  for (const n of Object.values(names)) {
    if (n.sectorClass === "financial") financial++;
    for (const k of n.eligible) counts[k]++;
  }
  return { total: Object.keys(names).length, financial, counts };
}

async function main() {
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const onlyUniverse = onlyArg ? onlyArg.split("=")[1] : null;
  const explicitTickers = args.filter((a) => !a.startsWith("--")).map((s) => s.toUpperCase());

  const { usSymbols, meta } = await loadSnapMeta();

  let symbols: string[];
  if (explicitTickers.length) {
    symbols = explicitTickers;
  } else if (onlyUniverse) {
    let snap: Snapshot | null = null;
    try {
      snap = JSON.parse(await fs.readFile(path.join(DATA_DIR, onlyUniverse, "snapshot.json"), "utf8")) as Snapshot;
    } catch {
      console.error(`No snapshot for universe ${onlyUniverse}`);
      process.exit(1);
    }
    symbols = snap!.stocks.map((s) => s.symbol);
  } else {
    symbols = usSymbols;
  }

  console.log(`Building valuation history for ${symbols.length} symbols${onlyUniverse ? ` (universe ${onlyUniverse})` : ""}…`);

  const names: Record<string, ValuationName> = {};
  let done = 0, ok = 0;
  // Concurrency 4: the global SEC token bucket (~7 req/s) is the real governor; this just bounds
  // burstiness. Each name makes ~2 SEC calls (quarterly + supplement) plus 1 Yahoo chart call.
  await mapPool(symbols, 4, async (sym) => {
    try {
      const vn = await computeName(sym, meta.get(sym));
      if (vn) {
        names[sym] = vn;
        ok++;
      }
    } catch (e) {
      /* skip a bad name */
    }
    if (++done % 50 === 0) console.log(`  ${done}/${symbols.length} (${ok} with data)`);
  });
  console.log(`  built ${ok}/${symbols.length} names`);

  // For an explicit-ticker test run, print the numbers and DON'T write the file.
  if (explicitTickers.length) {
    for (const sym of symbols) {
      const n = names[sym];
      if (!n) {
        console.log(`\n${sym}: (no data)`);
        continue;
      }
      console.log(`\n${sym}  [${n.sectorClass}]  eligible=${n.eligible.join(",")}  asOf=${n.asOf}`);
      for (const k of n.eligible) {
        const s = n.multiples[k]!;
        console.log(
          `  ${k.padEnd(9)} current=${s.current}  median=${s.median}  p25=${s.p25}  p75=${s.p75}  ` +
            `disc=${s.discountPct}%  z=${s.z}  n=${s.n}`,
        );
      }
    }
    const cov = coverageSummary(names);
    console.log(`\nCoverage: ${cov.total} names · pe=${cov.counts.pe} evEbitda=${cov.counts.evEbitda} ps=${cov.counts.ps} pb=${cov.counts.pb} · financials=${cov.financial}`);
    return;
  }

  // Build the data file.
  const asOfList = Object.values(names).map((n) => n.asOf).filter(Boolean).sort();
  const data: ValuationHistoryData = {
    generatedAt: new Date().toISOString(),
    asOf: asOfList.length ? asOfList[asOfList.length - 1] : null,
    names,
  };

  // Merge with any existing file so a single-universe run doesn't drop the OTHER universes' names.
  // CRUCIAL: first strip every symbol in THIS universe from the existing set, THEN overlay the fresh
  // build — otherwise a name this run intentionally dropped (now-suppressed garbage, an excluded
  // dual-class ticker, an EDGAR miss) would be resurrected from the stale file (the bug that kept
  // BRK-B / pre-guard PLTR alive after a re-run).
  const outPath = path.join(DATA_DIR, "valuation-history.json");
  if (onlyUniverse) {
    try {
      const existing = JSON.parse(await fs.readFile(outPath, "utf8")) as ValuationHistoryData;
      const thisUniverseSyms = new Set(symbols);
      const kept: Record<string, ValuationName> = {};
      for (const [sym, vn] of Object.entries(existing.names)) if (!thisUniverseSyms.has(sym)) kept[sym] = vn;
      data.names = { ...kept, ...names };
      const merged = Object.values(data.names).map((n) => n.asOf).filter(Boolean).sort();
      data.asOf = merged.length ? merged[merged.length - 1] : data.asOf;
    } catch {
      /* no existing file — write fresh */
    }
  }

  await fs.writeFile(outPath, JSON.stringify(data));
  const cov = coverageSummary(data.names);
  console.log(
    `Wrote ${outPath}\nCoverage: ${cov.total} names · pe=${cov.counts.pe} evEbitda=${cov.counts.evEbitda} ps=${cov.counts.ps} pb=${cov.counts.pb} · financials=${cov.financial}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
