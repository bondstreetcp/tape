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

function computeFund(raw: any[]): Fundamentals | null {
  const f = (x: any, k: string) => (typeof x?.[k] === "number" && Number.isFinite(x[k]) ? x[k] : null);
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
    fcfMargin: ratio(f(r[0], "freeCashFlow"), rev(0)),
    roe: ratio(f(r[0], "netIncome"), f(r[0], "stockholdersEquity")),
    netDebtEbitda: debt0 != null && ebitda0 && ebitda0 !== 0 ? (debt0 - (cash0 ?? 0)) / ebitda0 : null,
    currentRatio: ratio(f(r[0], "currentAssets"), f(r[0], "currentLiabilities")),
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
      const fund = computeFund(Array.isArray(r) ? r : []);
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
