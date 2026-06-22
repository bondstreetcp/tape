/**
 * Adds trend fundamentals (revenue growth, margin levels + expansion, DSO + ΔDSO,
 * FCF margin, ROE, leverage) to every snapshot's stocks, computed from annual
 * fundamentalsTimeSeries. Heavier than the price refresh (one call per name), so
 * it's a SEPARATE periodic patch — fundamentals change quarterly, not nightly.
 * build-data carries the existing `fund` over on a normal refresh.
 *
 *   npx tsx scripts/patch-fundamentals-deep.ts
 */
import { promises as fs } from "fs";
import path from "path";
import YahooFinance from "yahoo-finance2";
import { UNIVERSES } from "../lib/universes";
import type { Fundamentals, Snapshot } from "../lib/types";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DATA_DIR = path.join(process.cwd(), "data");

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

type FGet = (x: any, k: string) => number | null;

/** Piotroski F-score (0–9): 9 binary fundamental-strength signals, latest FY vs prior. */
function piotroski(r: any[], f: FGet): number | null {
  if (r.length < 2) return null;
  const ni0 = f(r[0], "netIncome"), ni1 = f(r[1], "netIncome");
  const ta0 = f(r[0], "totalAssets"), ta1 = f(r[1], "totalAssets");
  if (ni0 == null || ta0 == null || ta0 === 0) return null;
  const cfo0 = f(r[0], "operatingCashFlow") ?? f(r[0], "cashFlowFromContinuingOperatingActivities");
  const ltd0 = f(r[0], "longTermDebt") ?? f(r[0], "totalDebt"), ltd1 = f(r[1], "longTermDebt") ?? f(r[1], "totalDebt");
  const ca0 = f(r[0], "currentAssets"), cl0 = f(r[0], "currentLiabilities"), ca1 = f(r[1], "currentAssets"), cl1 = f(r[1], "currentLiabilities");
  const sh0 = f(r[0], "ordinarySharesNumber") ?? f(r[0], "shareIssued"), sh1 = f(r[1], "ordinarySharesNumber") ?? f(r[1], "shareIssued");
  const gp0 = f(r[0], "grossProfit"), gp1 = f(r[1], "grossProfit"), rev0 = f(r[0], "totalRevenue"), rev1 = f(r[1], "totalRevenue");
  const roa0 = ni0 / ta0, roa1 = ni1 != null && ta1 ? ni1 / ta1 : null;
  let s = 0;
  if (roa0 > 0) s++;                                                                  // 1 positive ROA
  if (cfo0 != null && cfo0 > 0) s++;                                                  // 2 positive operating cash flow
  if (roa1 != null && roa0 > roa1) s++;                                               // 3 ROA rising
  if (cfo0 != null && cfo0 > ni0) s++;                                                // 4 quality of earnings (CFO > NI)
  if (ltd0 != null && ltd1 != null && ta1 && ltd0 / ta0 < ltd1 / ta1) s++;            // 5 leverage falling
  if (ca0 != null && cl0 && ca1 != null && cl1 && ca0 / cl0 > ca1 / cl1) s++;         // 6 current ratio rising
  if (sh0 != null && sh1 != null && sh0 <= sh1 * 1.001) s++;                          // 7 no share dilution
  if (gp0 != null && rev0 && gp1 != null && rev1 && gp0 / rev0 > gp1 / rev1) s++;     // 8 gross margin rising
  if (rev0 != null && rev1 != null && ta1 && rev0 / ta0 > rev1 / ta1) s++;            // 9 asset turnover rising
  return s;
}

/** Meb Faber shareholder yield = dividend + net buyback + net debt-paydown, as a fraction. */
function shYield(r: any[], f: FGet, meta?: { marketCap: number; divYield: number | null }): number | null {
  if (!meta || r.length < 2) return null;
  const sh0 = f(r[0], "ordinarySharesNumber") ?? f(r[0], "shareIssued"), sh1 = f(r[1], "ordinarySharesNumber") ?? f(r[1], "shareIssued");
  const debt0 = f(r[0], "totalDebt"), debt1 = f(r[1], "totalDebt");
  const div = meta.divYield ?? 0;
  // Clamp the buyback & debt components to ±20% — a one-year share-count or debt swing
  // beyond that is almost always a spinoff/split/one-off deleveraging, not a repeatable
  // capital return, and would otherwise dominate the ranking with noise.
  const clamp = (x: number) => Math.max(-0.2, Math.min(0.2, x));
  const buyback = sh0 != null && sh1 ? clamp((sh1 - sh0) / sh1) : null;                // +ve when share count shrank
  const debtPay = debt0 != null && debt1 != null && meta.marketCap ? clamp((debt1 - debt0) / meta.marketCap) : 0; // +ve when debt fell
  if (buyback == null && !meta.divYield) return null;
  return div + (buyback ?? 0) + debtPay;
}

function computeFund(raw: any[], meta?: { marketCap: number; divYield: number | null }): Fundamentals | null {
  const f: FGet = (x: any, k: string) => (typeof x?.[k] === "number" && Number.isFinite(x[k]) ? x[k] : null);
  const r = (raw || [])
    .filter((x) => x?.totalRevenue != null && x?.date)
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
  if (r.length < 2) return null;
  const rev = (i: number) => f(r[i], "totalRevenue");
  const ar = (i: number) => f(r[i], "accountsReceivable") ?? f(r[i], "netReceivables") ?? f(r[i], "receivables");
  const ratio = (a: number | null, b: number | null) => (a != null && b != null && b !== 0 ? a / b : null);
  const sub = (a: number | null, b: number | null) => (a != null && b != null ? a - b : null);
  const margin = (k: string, i: number) => ratio(f(r[i], k), rev(i));
  const dsoAt = (i: number) => {
    const a = ar(i), rv = rev(i);
    return a != null && rv ? (a / rv) * 365 : null;
  };
  const debt0 = f(r[0], "totalDebt");
  const ebitda0 = f(r[0], "EBITDA");
  const cash0 = f(r[0], "cashAndCashEquivalents");
  // Graham NCAV = current assets − total liabilities (a name is a "net-net" when market cap < ⅔ NCAV).
  const totalLiab0 = f(r[0], "totalLiabilitiesNetMinorityInterest") ?? sub(f(r[0], "totalAssets"), f(r[0], "stockholdersEquity"));
  // FCF yield = free cash flow ÷ market cap (a true valuation yield, vs. FCF margin which is FCF ÷ revenue).
  const fcf0 = f(r[0], "freeCashFlow");
  // ROIC = NOPAT ÷ invested capital. NOPAT ≈ operating income taxed at the effective rate (default 23% if
  // we can't derive it); invested capital = debt + equity − cash (or Yahoo's investedCapital field if present).
  const ebit0 = f(r[0], "operatingIncome") ?? f(r[0], "EBIT");
  const tax0 = f(r[0], "taxProvision"), pretax0 = f(r[0], "pretaxIncome");
  const taxRate = tax0 != null && pretax0 != null && pretax0 > 0 ? Math.min(0.35, Math.max(0, tax0 / pretax0)) : 0.23;
  const equity0 = f(r[0], "stockholdersEquity");
  const investedCap = f(r[0], "investedCapital") ?? (equity0 != null ? equity0 + (debt0 ?? 0) - (cash0 ?? 0) : null);
  return {
    revGrowth: ratio(rev(0), rev(1)) != null ? rev(0)! / rev(1)! - 1 : null,
    revCagr3y: r.length >= 4 && rev(0) && rev(3) ? Math.pow(rev(0)! / rev(3)!, 1 / 3) - 1 : null,
    grossMargin: margin("grossProfit", 0),
    opMargin: margin("operatingIncome", 0),
    netMargin: margin("netIncome", 0),
    grossMarginChg: sub(margin("grossProfit", 0), margin("grossProfit", 1)),
    opMarginChg: sub(margin("operatingIncome", 0), margin("operatingIncome", 1)),
    netMarginChg: sub(margin("netIncome", 0), margin("netIncome", 1)),
    dso: dsoAt(0),
    dsoChg: sub(dsoAt(0), dsoAt(1)),
    fcfMargin: ratio(fcf0, rev(0)),
    fcfYield: fcf0 != null && meta?.marketCap ? fcf0 / meta.marketCap : null,
    roe: ratio(f(r[0], "netIncome"), f(r[0], "stockholdersEquity")),
    roic: ebit0 != null && investedCap != null && investedCap > 0 ? (ebit0 * (1 - taxRate)) / investedCap : null,
    netDebtEbitda: debt0 != null && ebitda0 && ebitda0 !== 0 ? (debt0 - (cash0 ?? 0)) / ebitda0 : null,
    currentRatio: ratio(f(r[0], "currentAssets"), f(r[0], "currentLiabilities")),
    ncav: sub(f(r[0], "currentAssets"), totalLiab0),
    fScore: piotroski(r, f),
    shareholderYield: shYield(r, f, meta),
    asOf: r[0].date ? new Date(r[0].date).toISOString().slice(0, 10) : null,
  };
}

async function main() {
  const snaps: Record<string, Snapshot> = {};
  const syms = new Set<string>();
  for (const u of UNIVERSES) {
    try {
      snaps[u.id] = JSON.parse(await fs.readFile(path.join(DATA_DIR, u.id, "snapshot.json"), "utf8")) as Snapshot;
      for (const st of snaps[u.id].stocks) syms.add(st.symbol);
    } catch {
      /* skip */
    }
  }
  // marketCap + dividend yield per symbol (for shareholder yield) from any snapshot carrying it.
  const metaBySym = new Map<string, { marketCap: number; divYield: number | null }>();
  for (const u of UNIVERSES) for (const st of snaps[u.id]?.stocks ?? []) if (!metaBySym.has(st.symbol)) metaBySym.set(st.symbol, { marketCap: st.marketCap, divYield: st.dividendYield ?? null });

  const symbols = [...syms];
  console.log(`Fetching annual fundamentals for ${symbols.length} symbols…`);
  const fundMap = new Map<string, Fundamentals>();
  let done = 0, ok = 0;
  await mapPool(symbols, 8, async (sym) => {
    try {
      const r: any = await yf.fundamentalsTimeSeries(
        sym,
        { period1: "2019-01-01", type: "annual", module: "all" } as any,
        { validateResult: false },
      );
      const fund = computeFund(Array.isArray(r) ? r : [], metaBySym.get(sym));
      if (fund) {
        fundMap.set(sym, fund);
        ok++;
      }
    } catch {
      /* skip */
    }
    if (++done % 250 === 0) console.log(`  ${done}/${symbols.length} (${ok} with data)`);
  });
  console.log(`  got fundamentals for ${ok}/${symbols.length}`);

  for (const u of UNIVERSES) {
    const s = snaps[u.id];
    if (!s) continue;
    let n = 0;
    for (const st of s.stocks) {
      const fund = fundMap.get(st.symbol);
      if (fund) {
        st.fund = fund;
        n++;
      }
    }
    await fs.writeFile(path.join(DATA_DIR, u.id, "snapshot.json"), JSON.stringify(s));
    console.log(`  ${u.id}: patched ${n}/${s.stocks.length}`);
  }
  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
