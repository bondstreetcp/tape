/**
 * refresh-insiders — universe-wide SEC Form 4 open-market BUY scan for the Insider Cluster-Buying
 * board. For each US name it pulls recent Form 4 filings (reusing lib/edgar's parser) and keeps
 * open-market purchases (transaction code P) in a trailing window, aggregating the cluster signal:
 * how many distinct insiders bought, total shares + $ value, and the most recent buy.
 *
 *   npm run refresh-insiders                 # the US universe union
 *   npm run refresh-insiders -- --only=sp500
 *   npm run refresh-insiders -- AAPL OXY     # print, don't write (test)
 *
 * EDGAR asks for <10 req/s — concurrency 3 + a short delay keeps us ~6 req/s (the Overnight-Filings
 * scan's proven rate).
 */
import { promises as fs } from "fs";
import path from "path";
import { UNIVERSES } from "../lib/universes";
import { tickerToCik, getForm4List, parseForm4, pool } from "../lib/edgar";
import type { Snapshot } from "../lib/types";
import type { InsiderBuy, InsidersFile, NameBuys } from "../lib/insiders";

const DATA_DIR = path.join(process.cwd(), "data");
const WINDOW_DAYS = 90; // trailing window for "recent" open-market buys
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

async function loadUsSymbols(): Promise<string[]> {
  const US = ["russell3000", "sp1500", "russell1000", "sp500", "nasdaq100"];
  const usIds = UNIVERSES.filter((u) => !u.international).map((u) => u.id);
  const ordered = [...US.filter((id) => usIds.includes(id)), ...usIds.filter((id) => !US.includes(id))];
  const seen = new Set<string>();
  const order: string[] = [];
  for (const id of ordered) {
    try {
      const snap = JSON.parse(await fs.readFile(path.join(DATA_DIR, id, "snapshot.json"), "utf8")) as Snapshot;
      for (const s of snap.stocks) if (!seen.has(s.symbol)) { seen.add(s.symbol); order.push(s.symbol); }
    } catch {
      /* universe not present locally */
    }
  }
  return order;
}

// Aggregate one symbol's recent open-market buys into the cluster signal. We filter the Form 4
// LIST to the window by filing date BEFORE parsing, so we only fetch the handful of in-window XMLs
// per name (not 40) — that's what makes a universe-wide nightly scan feasible.
async function scanSymbol(sym: string): Promise<NameBuys | null> {
  const cik = await tickerToCik(sym);
  if (!cik) return null;
  const cutoff = new Date(Date.now() - WINDOW_DAYS * 86400 * 1000).toISOString().slice(0, 10);
  const fileCutoff = new Date(Date.now() - (WINDOW_DAYS + 7) * 86400 * 1000).toISOString().slice(0, 10); // filing lags the trade a few days
  const list = (await getForm4List(cik)).filter((f) => f.date >= fileCutoff);
  if (!list.length) return null;
  const parsed = (await pool(list, 4, (f) => parseForm4(cik, f))).flat();
  const buys = parsed.filter((t) => t.code === "P" && t.acquired && t.date >= cutoff && (t.shares ?? 0) > 0);
  if (!buys.length) return null;

  // De-dupe to the cluster signal: distinct insiders, total $ and shares, latest buy.
  const insiderNames = new Set(buys.map((b) => b.insider));
  let totalShares = 0, totalValue = 0, valued = 0;
  for (const b of buys) {
    totalShares += b.shares ?? 0;
    if (b.value != null) { totalValue += b.value; valued++; }
  }
  const top: InsiderBuy[] = buys
    .slice()
    .sort((a, b) => (b.value ?? 0) - (a.value ?? 0))
    .slice(0, 6)
    .map((b) => ({ insider: b.insider, role: b.role, date: b.date, shares: b.shares, price: b.price, value: b.value }));
  const lastDate = buys.reduce((m, b) => (b.date > m ? b.date : m), buys[0].date);

  return {
    buyers: insiderNames.size,
    transactions: buys.length,
    totalShares,
    totalValue: valued ? totalValue : null,
    lastBuy: lastDate,
    top,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const onlyArg = args.find((a) => a.startsWith("--only="));
  const onlyUniverse = onlyArg ? onlyArg.split("=")[1] : null;
  const explicit = args.filter((a) => !a.startsWith("--")).map((s) => s.toUpperCase());

  let symbols: string[];
  if (explicit.length) {
    symbols = explicit;
  } else if (onlyUniverse) {
    const snap = JSON.parse(await fs.readFile(path.join(DATA_DIR, onlyUniverse, "snapshot.json"), "utf8")) as Snapshot;
    symbols = snap.stocks.map((s) => s.symbol);
  } else {
    symbols = await loadUsSymbols();
  }

  console.log(`Scanning Form 4 open-market buys (last ${WINDOW_DAYS}d) for ${symbols.length} symbols${onlyUniverse ? ` (${onlyUniverse})` : ""}…`);
  const names: Record<string, NameBuys> = {};
  let done = 0, hit = 0;
  await mapPool(symbols, 3, async (sym) => {
    try {
      const nb = await scanSymbol(sym);
      if (nb) { names[sym] = nb; hit++; }
    } catch {
      /* skip a bad name */
    }
    await sleep(120); // keep us comfortably under EDGAR's ~10 req/s
    if (++done % 50 === 0) console.log(`  ${done}/${symbols.length} (${hit} with buys)`);
  });
  console.log(`  ${hit}/${symbols.length} names had open-market buys in the window`);

  if (explicit.length) {
    for (const s of symbols) console.log(`${s}: ${JSON.stringify(names[s] ?? null)}`);
    return;
  }

  const out: InsidersFile = { generatedAt: new Date().toISOString(), asOf: new Date().toISOString().slice(0, 10), windowDays: WINDOW_DAYS, names };
  const outPath = path.join(DATA_DIR, "insiders.json");
  if (onlyUniverse) {
    try {
      const existing = JSON.parse(await fs.readFile(outPath, "utf8")) as InsidersFile;
      const thisSet = new Set(symbols);
      const kept: Record<string, NameBuys> = {};
      for (const [k, v] of Object.entries(existing.names)) if (!thisSet.has(k)) kept[k] = v;
      out.names = { ...kept, ...names };
    } catch {
      /* no existing file */
    }
  }
  await fs.writeFile(outPath, JSON.stringify(out));
  console.log(`Wrote ${outPath} (${Object.keys(out.names).length} names with buys)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
