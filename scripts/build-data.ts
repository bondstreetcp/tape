/**
 * Pulls market data for every universe's constituents (the union is fetched
 * once, deduped) plus the 11 sector ETFs, and writes:
 *
 *   data/series/symbols/<SYM>.json  — { daily, intraday } compact [t,c] series (shared)
 *   data/<universe>/snapshot.json   — stocks + sector aggregates for each universe
 *
 * 5 years of daily history (for 3Y/5Y). Intraday is fetched only for symbols in
 * universes flagged `intraday` (S&P 500, Nasdaq 100) to keep refreshes sane.
 *
 *   npm run refresh-data
 *   LIMIT=60 npm run refresh-data     # quick subset of the union
 */
import { promises as fs } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { UNIVERSES } from "../lib/universes";
import { GICS_TO_ETF, SECTORS, SECTOR_ETFS, sectorOverrideFromIndustry } from "../lib/sectors";
import { LOOKBACK_TRADING_DAYS } from "../lib/timeframes";
import { symbolFile } from "../lib/symbolfile";
import {
  adjustForCorporateActions, splitsFromYahoo, mergeSplitLedger, LEDGER_WINDOW_DAYS,
  type SplitEvent, type SplitLedgerFile,
} from "../lib/splits";
import { snapshotWriteAllowed } from "../lib/snapshotGuard";
import { carryForwardRows, coverageShortfall } from "../lib/universeCarry";
import { notifyAlert } from "../lib/alertNotify";
import { isDateLikeSymbol } from "./iwv";
import type {
  Returns,
  SectorAgg,
  SeriesPoint,
  Snapshot,
  StockRow,
  StockSeries,
  XY,
} from "../lib/types";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA_DIR = path.join(process.cwd(), "data");
const SYMBOL_DIR = path.join(DATA_DIR, "series", "symbols");
const DAY = 86_400_000;
const NOW = Date.now();
const YEAR = new Date(NOW).getFullYear();
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 0;

// Yahoo's sector taxonomy → SPDR sector ETF (for assetProfile-enriched stragglers).
const YH_SECTOR_TO_ETF: Record<string, string> = {
  Technology: "XLK",
  Healthcare: "XLV",
  "Financial Services": "XLF",
  "Consumer Cyclical": "XLY",
  "Consumer Defensive": "XLP",
  Energy: "XLE",
  Industrials: "XLI",
  "Basic Materials": "XLB",
  "Real Estate": "XLRE",
  Utilities: "XLU",
  "Communication Services": "XLC",
};

interface Entry {
  symbol: string;
  name: string;
  sector: string;
  industry: string;
}
interface Klass {
  name: string;
  sector: string;
  industry: string;
  etf?: string;
}
interface Metric {
  name: string;
  price: number;
  marketCap: number;
  returns: Returns;
  high: number;
  low: number;
  pctFromHigh: number;
  pctFromLow: number;
  trailingPE: number | null;
  forwardPE: number | null;
  priceToBook: number | null;
  dividendYield: number | null;
  fiftyDayAverage: number | null;
  twoHundredDayAverage: number | null;
  earningsDate: string | null;
  earningsEstimate: boolean;
  epsForward: number | null;
}

const qnum = (v: any): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function mapPool<T, R>(
  items: T[],
  size: number,
  fn: (item: T, i: number) => Promise<R>,
): Promise<R[]> {
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

function toPoints(quotes: any[]): SeriesPoint[] {
  return (quotes || [])
    .filter((q) => q && q.close != null && q.date)
    .map((q) => ({ t: new Date(q.date).getTime(), c: q.close as number }))
    .sort((a, b) => a.t - b.t);
}

const round2 = (n: number) => Math.round(n * 100) / 100;
const toXY = (pts: SeriesPoint[]): XY[] => pts.map((p) => [p.t, round2(p.c)]);

/** Per-day adjusted-close as [t, adjclose] (raw, unrounded) — feeds the spinoff pass.
 *  Yahoo names it `adjclose` (sometimes `adjClose`); only present with events requested. */
function adjCloseXY(quotes: any[]): XY[] {
  return (quotes || [])
    .filter((q) => q && q.date && (q.adjclose ?? q.adjClose) != null)
    .map((q) => [new Date(q.date).getTime(), (q.adjclose ?? q.adjClose) as number] as XY)
    .sort((a, b) => a[0] - b[0]);
}

function emptyReturns(): Returns {
  return { "1d": null, "1w": null, "3m": null, "6m": null, ytd: null, "1y": null, "3y": null, "5y": null };
}

function returnsFromPoints(pts: SeriesPoint[]): Returns {
  const closes = pts.map((p) => p.c);
  const last = closes.length ? closes[closes.length - 1] : null;
  const lookback = (n: number): number | null => {
    if (closes.length < 2 || last == null) return null;
    let idx = closes.length - 1 - n;
    if (idx < 0) idx = 0;
    const base = closes[idx];
    return base ? (last / base - 1) * 100 : null;
  };
  let ytd: number | null = null;
  const firstThisYear = pts.findIndex((p) => new Date(p.t).getFullYear() === YEAR);
  if (firstThisYear >= 0 && last != null) {
    const base = closes[firstThisYear > 0 ? firstThisYear - 1 : firstThisYear];
    if (base) ytd = (last / base - 1) * 100;
  }
  let d1: number | null = null;
  if (closes.length >= 2 && last != null) {
    const prev = closes[closes.length - 2];
    if (prev) d1 = (last / prev - 1) * 100;
  }
  return {
    "1d": d1,
    "1w": lookback(LOOKBACK_TRADING_DAYS["1w"]),
    "3m": lookback(LOOKBACK_TRADING_DAYS["3m"]),
    "6m": lookback(LOOKBACK_TRADING_DAYS["6m"]),
    ytd,
    "1y": lookback(LOOKBACK_TRADING_DAYS["1y"]),
    "3y": lookback(LOOKBACK_TRADING_DAYS["3y"]),
    "5y": lookback(LOOKBACK_TRADING_DAYS["5y"]),
  };
}

async function fetchQuotes(symbols: string[]): Promise<Map<string, any>> {
  const map = new Map<string, any>();
  for (const part of chunk(symbols, 50)) {
    try {
      const qs = (await yf.quote(part, {}, { validateResult: false })) as any[];
      for (const q of qs) if (q?.symbol) map.set(q.symbol, q);
    } catch (e: any) {
      for (const s of part) {
        try {
          const q = await yf.quote(s, {}, { validateResult: false });
          if (q?.symbol) map.set(q.symbol, q);
        } catch {
          /* skip */
        }
      }
    }
  }
  return map;
}

async function main() {
  // 1) Load universe lists, build union + classification + intraday set.
  const universeLists: Record<string, Entry[]> = {};
  for (const u of UNIVERSES) {
    const raw = await fs.readFile(
      path.join(DATA_DIR, "constituents", `${u.id}.json`),
      "utf8",
    );
    universeLists[u.id] = JSON.parse(raw) as Entry[];
  }

  const intradayUniverses = new Set(UNIVERSES.filter((u) => u.intraday).map((u) => u.id));
  const classBySym = new Map<string, Klass>();
  const needIntraday = new Set<string>();
  for (const u of UNIVERSES) {
    for (const e of universeLists[u.id]) {
      const existing = classBySym.get(e.symbol);
      const ov = sectorOverrideFromIndustry(e.industry); // correct e.g. a bank tagged "Health Care"
      if (!existing) {
        classBySym.set(e.symbol, {
          name: e.name,
          sector: ov ? ov.name : e.sector,
          industry: e.industry,
          etf: ov ? ov.etf : e.sector ? GICS_TO_ETF[e.sector] : undefined,
        });
      } else if (!existing.sector && e.sector) {
        existing.sector = ov ? ov.name : e.sector;
        existing.industry = e.industry;
        existing.etf = ov ? ov.etf : GICS_TO_ETF[e.sector];
      }
      if (intradayUniverses.has(u.id)) needIntraday.add(e.symbol);
    }
  }

  let allSymbols = [...classBySym.keys()];
  if (LIMIT > 0) allSymbols = allSymbols.slice(0, LIMIT);
  console.log(`Union: ${allSymbols.length} symbols (intraday for ${needIntraday.size}).`);

  // 2) Enrich unclassified symbols via Yahoo assetProfile.
  const unclassified = allSymbols.filter((s) => !classBySym.get(s)?.etf);
  if (unclassified.length) {
    console.log(`Enriching ${unclassified.length} symbols via assetProfile…`);
    await mapPool(unclassified, 8, async (sym) => {
      try {
        const r: any = await yf.quoteSummary(
          sym,
          { modules: ["assetProfile"] },
          { validateResult: false },
        );
        const sector = r?.assetProfile?.sector;
        const industry = r?.assetProfile?.industry;
        const etf = sector ? YH_SECTOR_TO_ETF[sector] : undefined;
        const c = classBySym.get(sym)!;
        if (etf) {
          c.etf = etf;
          c.sector = sector;
          c.industry = industry || c.industry || "Other";
        }
      } catch {
        /* leave unclassified — it will be dropped from universes */
      }
    });
  }

  // 3) Quotes for the union.
  console.log("Fetching quotes…");
  const quoteMap = await fetchQuotes(allSymbols);
  console.log(`  got ${quoteMap.size}/${allSymbols.length}`);

  // 4) Per-symbol history → compute metrics, write series files.
  await fs.mkdir(SYMBOL_DIR, { recursive: true });
  const dailyPeriod1 = new Date(NOW - 2010 * DAY); // ~5.5y
  const intradayPeriod1 = new Date(NOW - 8 * DAY);
  let done = 0;
  const metricBySym = new Map<string, Metric>();
  // Splits seen this run, per symbol — we already pay for these events, so record them (see
  // lib/splits' ledger section). Only symbols whose fetch SUCCEEDED get a key: an absent symbol
  // means "didn't learn anything tonight", which merge treats very differently from "no splits".
  const splitsBySym = new Map<string, SplitEvent[]>();

  await mapPool(allSymbols, 16, async (sym) => {
    const q = quoteMap.get(sym);
    let returns = emptyReturns();
    let meta: any = {};
    let dailyXY: XY[] = [];
    let intradayXY: XY[] = [];
    let lastClose: number | null = null;
    // Daily history — retry past Yahoo's rate-limiting (it throttles deep into a
    // ~3,000-symbol run, which used to blank a third of the series). On a persistent
    // miss, fall back to the existing series file so a transient failure never wipes a
    // name's chart/returns.
    let pts: SeriesPoint[] = [];
    let adjXY: XY[] = []; // per-day adjusted-close, aligned to pts — drives the spinoff pass
    let splitEvents: SplitEvent[] = [];
    for (let attempt = 0; attempt < 3 && pts.length === 0; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 300 + attempt * 500));
      try {
        // events:"div,split" so we get splits (for the split countermeasure) AND adjclose
        // (Yahoo only fills adjclose when dividend/split events are requested) — adjclose
        // drives the spinoff-continuity pass below.
        const ch: any = await yf.chart(sym, { period1: dailyPeriod1, interval: "1d", events: "div,split" }, { validateResult: false });
        meta = ch?.meta || meta;
        pts = toPoints(ch?.quotes);
        adjXY = adjCloseXY(ch?.quotes);
        splitEvents = splitsFromYahoo(ch?.events);
        splitsBySym.set(sym, splitEvents); // the call returned ⇒ this IS the truth for this symbol
      } catch {
        /* retry */
      }
    }
    if (pts.length === 0) {
      try {
        const prev = JSON.parse(await fs.readFile(path.join(SYMBOL_DIR, symbolFile(sym)), "utf8"));
        if (Array.isArray(prev.daily) && prev.daily.length) pts = (prev.daily as XY[]).map(([t, c]) => ({ t, c }));
      } catch {
        /* no prior series */
      }
    }
    // Corporate-action continuity guard (split + spinoff). If Yahoo served an
    // UNADJUSTED series across a recent split (its back-adjustment lags a few days),
    // scale the pre-split closes onto the post-split basis — so a split can never inject
    // the "+198%" discontinuity. Then run the spinoff pass: a spinoff steps the parent's
    // price DOWN at ex (shareholders get parent + spinco, total return ~flat). Most
    // spinoffs Yahoo already bakes into `close` (handled implicitly — no-op) or encodes as
    // a ratio-split (handled by the split pass above); the spinoff pass is the
    // belt-and-suspenders detector via the adjclose/close back-adjust factor for any case
    // where `close` is unadjusted across a spinoff. All passes no-op when already adjusted.
    dailyXY = toXY(pts);
    if (dailyXY.length && (splitEvents.length || adjXY.length)) {
      const { daily: adj, splitApplied, spinoffApplied } = adjustForCorporateActions(dailyXY, splitEvents, adjXY);
      if (splitApplied.length || spinoffApplied.length) {
        dailyXY = adj;
        pts = adj.map(([t, c]) => ({ t, c }));
        if (splitApplied.length)
          console.log(`  ${sym}: split-adjusted unadjusted series at ${splitApplied.map((d) => new Date(d).toISOString().slice(0, 10)).join(", ")}`);
        if (spinoffApplied.length)
          console.log(`  ${sym}: spinoff-adjusted (continuity) at ${spinoffApplied.map((d) => new Date(d).toISOString().slice(0, 10)).join(", ")}`);
      }
    }
    if (pts.length) lastClose = pts[pts.length - 1].c;
    returns = returnsFromPoints(pts);
    if (needIntraday.has(sym)) {
      try {
        const ch: any = await yf.chart(
          sym,
          { period1: intradayPeriod1, interval: "15m", includePrePost: false },
          { validateResult: false },
        );
        intradayXY = toXY(toPoints(ch?.quotes));
      } catch {
        /* optional */
      }
    }
    if (q && typeof q.regularMarketChangePercent === "number") {
      returns["1d"] = q.regularMarketChangePercent;
    }

    const price = q?.regularMarketPrice ?? meta.regularMarketPrice ?? lastClose ?? 0;
    const high = q?.fiftyTwoWeekHigh ?? meta.fiftyTwoWeekHigh ?? 0;
    const low = q?.fiftyTwoWeekLow ?? meta.fiftyTwoWeekLow ?? 0;

    // Never clobber a good series with an empty fetch — only write when we have data
    // (a dead/delisted symbol simply keeps whatever was there, or no file).
    if (dailyXY.length)
      await fs.writeFile(
        path.join(SYMBOL_DIR, symbolFile(sym)),
        JSON.stringify({ daily: dailyXY, intraday: intradayXY } satisfies StockSeries),
      );

    metricBySym.set(sym, {
      name: q?.longName || q?.shortName || classBySym.get(sym)?.name || sym,
      price,
      marketCap: q?.marketCap || 0,
      returns,
      high,
      low,
      pctFromHigh: high ? (price / high - 1) * 100 : 0,
      pctFromLow: low ? (price / low - 1) * 100 : 0,
      trailingPE: qnum(q?.trailingPE),
      forwardPE: qnum(q?.forwardPE),
      priceToBook: qnum(q?.priceToBook),
      dividendYield: qnum(q?.trailingAnnualDividendYield),
      fiftyDayAverage: qnum(q?.fiftyDayAverage),
      twoHundredDayAverage: qnum(q?.twoHundredDayAverage),
      earningsDate: q?.earningsTimestampStart ? new Date(q.earningsTimestampStart).toISOString() : null,
      earningsEstimate: !!q?.isEarningsDateEstimate,
      epsForward: qnum(q?.epsForward),
    });

    if (++done % 100 === 0) console.log(`  ${done}/${allSymbols.length}`);
  });

  // 5) Sector ETFs: series + returns (shared across universes).
  console.log("Fetching sector ETFs…");
  const etfQuoteMap = await fetchQuotes(SECTOR_ETFS);
  const etfReturns = new Map<string, Returns>();
  for (const etf of SECTOR_ETFS) {
    let daily: SeriesPoint[] = [];
    let intraday: SeriesPoint[] = [];
    // ETFs drive the sector heatmap + indices — retry so a transient rate-limit
    // at the tail of a big refresh can't leave them empty.
    for (let attempt = 0; attempt < 3 && daily.length === 0; attempt++) {
      if (attempt > 0) await new Promise((r) => setTimeout(r, 1500));
      try {
        const ch: any = await yf.chart(
          etf,
          { period1: dailyPeriod1, interval: "1d" },
          { validateResult: false },
        );
        daily = toPoints(ch?.quotes);
      } catch {}
    }
    try {
      const ch: any = await yf.chart(
        etf,
        { period1: intradayPeriod1, interval: "15m" },
        { validateResult: false },
      );
      intraday = toPoints(ch?.quotes);
    } catch {}
    const r = returnsFromPoints(daily);
    const eq = etfQuoteMap.get(etf);
    if (eq && typeof eq.regularMarketChangePercent === "number")
      r["1d"] = eq.regularMarketChangePercent;
    etfReturns.set(etf, r);
    // Don't overwrite a good series with an empty fetch (rate-limit at the tail of a
    // big run) — leaving the prior file keeps the sector's returns from going blank.
    if (daily.length > 0)
      await fs.writeFile(
        path.join(SYMBOL_DIR, symbolFile(etf)),
        JSON.stringify({ daily: toXY(daily), intraday: toXY(intraday) }),
      );
  }

  // Carry trend fundamentals over from the previous snapshots — they're refreshed
  // by the separate (heavier) patch-fundamentals-deep, not on every price refresh.
  const existingFund = new Map<string, unknown>();
  for (const u of UNIVERSES) {
    try {
      const prev = JSON.parse(await fs.readFile(path.join(DATA_DIR, u.id, "snapshot.json"), "utf8"));
      for (const st of prev.stocks || []) if (st.fund && !existingFund.has(st.symbol)) existingFund.set(st.symbol, st.fund);
    } catch {
      /* no prior snapshot */
    }
  }

  // 6) Assemble per-universe snapshots.
  console.log("Writing per-universe snapshots…");
  const blocked: string[] = []; // universes whose snapshot collapsed this run (write-guard kept the prior)
  const shortfalls: string[] = []; // universes shipping fewer names than the index lists (absolute check)
  for (const u of UNIVERSES) {
    const stocks: StockRow[] = [];
    const seen = new Set<string>();
    // Prior snapshot, read BEFORE the row loop (it used to be read only for the carry below):
    // THE 2026-08-06 DIAGNOSIS — Yahoo serves this host DEGRADED quote payloads for a stable subset
    // of symbols (ADI/AFL/AMD…, verified live: price present, marketCap AND sharesOutstanding both
    // stripped; the same call from another host returns them). The old gate treated price-without-cap
    // as a failed fetch, which manufactured the deterministic nightly 121-name russell1000 hole out
    // of quotes that had SUCCEEDED. Salvage: re-price the prior night's cap with the fresh price
    // (prior cap ÷ prior price × fresh price — share counts don't move overnight). A fresh-price row
    // with a re-priced cap is honest data; a carried or missing row was the strictly worse outcome.
    const priorBySym = new Map<string, StockRow>();
    try {
      const prev = JSON.parse(await fs.readFile(path.join(DATA_DIR, u.id, "snapshot.json"), "utf8")) as Snapshot;
      for (const r of prev.stocks ?? []) priorBySym.set(r.symbol, r);
    } catch { /* first build of this universe */ }
    let capSalvaged = 0;
    for (const e of universeLists[u.id]) {
      if (seen.has(e.symbol)) continue;
      seen.add(e.symbol);
      const c = classBySym.get(e.symbol);
      const m = metricBySym.get(e.symbol);
      // drop unmapped / no-data / junk rows (no price → empty cells)
      if (!c?.etf || !m || !m.price) continue;
      if (!m.marketCap) {
        const p = priorBySym.get(e.symbol);
        if (p?.marketCap && p.price && p.price > 0) {
          m.marketCap = Math.round((p.marketCap / p.price) * m.price);
          capSalvaged++;
        } else continue; // no cap and nothing to re-price from → genuinely unusable row
      }
      stocks.push({
        symbol: e.symbol,
        name: m.name,
        etf: c.etf,
        sector: c.sector,
        industry: c.industry || "Other",
        marketCap: m.marketCap,
        price: m.price,
        returns: m.returns,
        fiftyTwoWeekHigh: m.high,
        fiftyTwoWeekLow: m.low,
        pctFromHigh: m.pctFromHigh,
        pctFromLow: m.pctFromLow,
        trailingPE: m.trailingPE,
        forwardPE: m.forwardPE,
        priceToBook: m.priceToBook,
        dividendYield: m.dividendYield,
        fiftyDayAverage: m.fiftyDayAverage,
        twoHundredDayAverage: m.twoHundredDayAverage,
        earningsDate: m.earningsDate,
        earningsEstimate: m.earningsEstimate,
        epsForward: m.epsForward,
        fund: (existingFund.get(e.symbol) as StockRow["fund"]) ?? null,
      });
    }
    // ── CARRY-FORWARD: a listed name we failed to fetch goes STALE, not MISSING ──────────────────
    // The `continue` above drops any constituent whose quote came back without a cap or price. That is
    // right for junk and catastrophic for a transient vendor failure — and on a 2,600-name pull the
    // latter is routine. MEASURED 2026-07-30: this universe shipped 2,228 of 2,593 real constituents;
    // 365 names (MTCH, HUM, LNG, DVN, MTD) simply vanished, and most fetched fine hours later.
    // A vanished row is invisible and silently shrinks every screen and breadth stat computed over the
    // universe. A stale row is visible, bounded, and self-corrects on the next good fetch.
    const snapPath = path.join(DATA_DIR, u.id, "snapshot.json");
    const priorRows: StockRow[] = [...priorBySym.values()]; // read once above (cap salvage + carry share it)
    const prevCount = priorRows.length || null;

    // Date-like junk from the holdings export can never resolve, so it must not count as "expected"
    // when we measure coverage — otherwise 313 unresolvable rows mask a real 14% shortfall.
    const listedReal = universeLists[u.id].map((e) => e.symbol).filter((s) => s && !isDateLikeSymbol(s));
    const carry = carryForwardRows(
      listedReal,
      new Map(stocks.map((r) => [r.symbol, r])),
      new Map(priorRows.map((r) => [r.symbol, r])),
      { nowMs: NOW },
    );
    const merged = carry.rows;
    if (carry.carried.length || carry.expired.length) {
      console.log(
        `  ${u.id}: carried ${carry.carried.length} stale row(s) through a failed fetch` +
        (carry.expired.length ? `, expired ${carry.expired.length} past the carry window` : "") +
        (carry.carried.length ? ` — e.g. ${carry.carried.slice(0, 6).join(", ")}` : ""),
      );
    }

    // Sector aggregates are computed AFTER the carry so counts and market caps reflect the universe
    // we actually ship, not the subset that happened to answer tonight.
    const sectors: SectorAgg[] = SECTORS.map((s) => {
      const members = merged.filter((x) => x.etf === s.etf);
      return {
        etf: s.etf,
        name: s.name,
        returns: etfReturns.get(s.etf) ?? emptyReturns(),
        count: members.length,
        marketCap: members.reduce((a, b) => a + (b.marketCap || 0), 0),
      };
    }).filter((s) => s.count > 0);

    const snapshot: Snapshot = {
      generatedAt: new Date(NOW).toISOString(),
      stocks: merged,
      sectors,
    };
    // Write-guard: never REPLACE a healthy snapshot with a collapsed one — a night-over-night cliff.
    const guard = snapshotWriteAllowed(prevCount, merged.length);
    if (!guard.allowed) {
      console.error(`  ⚠ ${u.id}: ${guard.reason} — SKIPPING write, keeping prior snapshot`);
      blocked.push(u.id);
      continue;
    }
    // ABSOLUTE coverage check — the question the write-guard structurally cannot ask. It compares to
    // LAST NIGHT, so a universe that erodes 13% a night passes every single write while ratcheting
    // away; only a check against what the INDEX says should be there can see a slow leak.
    const cov = coverageShortfall(merged.length, listedReal.length);
    if (!cov.ok) {
      shortfalls.push(`${u.id} ${merged.length}/${listedReal.length} (−${Math.round(cov.shortfall * 100)}%)`);
      console.error(`  ⚠ ${u.id}: only ${merged.length} of ${listedReal.length} listed constituents — ${cov.missing} missing (${Math.round(cov.shortfall * 100)}%)`);
    }
    await fs.mkdir(path.join(DATA_DIR, u.id), { recursive: true });
    await fs.writeFile(snapPath, JSON.stringify(snapshot));
    console.log(`  ${u.id}: ${merged.length} stocks (${carry.fresh.length} fresh, ${carry.carried.length} carried${capSalvaged ? `, ${capSalvaged} cap-salvaged` : ""}), ${sectors.length} sectors`);
  }
  if (shortfalls.length) {
    console.error(`\n⚠ COVERAGE SHORTFALL — these universes are missing listed constituents: ${shortfalls.join("; ")}`);
    // Same lesson as the freshness gate (2026-08-05): a log line in a nightly nobody reads is not an
    // alarm. The 124-megacap russell1000 hole rode exactly this print for days. One webhook per FULL
    // run at most; no-op when ALERT_WEBHOOK_URL is unset.
    await notifyAlert(
      `Universe coverage shortfall (fetched vs what the index lists):\n${shortfalls.map((s) => `• ${s}`).join("\n")}\nRows the index lists that neither fetched nor carried. See the FULL-run log.`,
      "Tape universe coverage short",
    );
  }
  if (blocked.length) console.error(`\n⚠ write-guard kept the prior snapshot for ${blocked.length} universe(s): ${blocked.join(", ")} (partial fetch this run). npm run check-freshness will flag any that stay stale.`);

  // 7) Split ledger — free: step 4 already fetched these events for the countermeasure.
  // Non-fatal by design: this is a by-product, and a snapshot run that otherwise succeeded must not
  // exit 1 over it. Merge semantics mean a skipped night just leaves the ledger where it was.
  try {
    const LEDGER = path.join(DATA_DIR, "splits.json");
    let prevLedger: SplitLedgerFile | null = null;
    try { prevLedger = JSON.parse(await fs.readFile(LEDGER, "utf8")) as SplitLedgerFile; } catch { /* first run */ }
    const ledger = mergeSplitLedger(prevLedger, splitsBySym, NOW);
    await fs.writeFile(LEDGER, JSON.stringify(ledger));
    const n = Object.values(ledger.splits).reduce((a, s) => a + s.length, 0);
    const learned = [...splitsBySym.values()].filter((s) => s.length).length;
    console.log(`\nSplit ledger: ${n} splits across ${Object.keys(ledger.splits).length} symbols (last ${LEDGER_WINDOW_DAYS}d) — ${splitsBySym.size}/${allSymbols.length} symbols observed, ${learned} with splits on record.`);
  } catch (e) {
    console.error(`⚠ split ledger not written: ${String((e as any)?.message || e)} — signal-log entry prices will re-base tomorrow instead.`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
