/**
 * refresh-estimates — snapshot each name's consensus-EPS revision block (now vs 30/90d ago + the
 * up/down analyst-revision counts) universe-wide into data/estimates.json, for the Revisions
 * Momentum board. Reuses getCompanyStats (one Yahoo quoteSummary per name).
 *
 *   npm run refresh-estimates              # the US universe union (russell3000 ∪ …)
 *   npm run refresh-estimates -- --only=sp500
 *   npm run refresh-estimates -- AAPL MSFT # print, don't write (test)
 */
import { promises as fs } from "fs";
import path from "path";
import { UNIVERSES } from "../lib/universes";
import { getCompanyStats, type CompanyStats } from "../lib/companyStats";
import type { Snapshot } from "../lib/types";
import type { EstSnap, EstimatesFile } from "../lib/revisions";

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

function extract(stats: CompanyStats): EstSnap | null {
  const cy = stats.estimates.find((e) => e.period === "0y");
  const ny = stats.estimates.find((e) => e.period === "+1y");
  if (!cy && !ny) return null;
  const snap: EstSnap = {
    cyNow: cy?.epsCurrent ?? null,
    cy30d: cy?.eps30dAgo ?? null,
    cy90d: cy?.eps90dAgo ?? null,
    up30d: cy?.epsUp30d ?? null,
    down30d: cy?.epsDown30d ?? null,
    nyNow: ny?.epsCurrent ?? null,
    ny90d: ny?.eps90dAgo ?? null,
    price: stats.price ?? null,
    target: stats.targetMean ?? null,
    analysts: stats.numAnalysts ?? null,
    recKey: stats.recommendationKey ?? null,
    recMean: stats.recommendationMean ?? null,
    targetHigh: stats.targetHigh ?? null,
    targetLow: stats.targetLow ?? null,
    shortPctFloat: stats.shortPercentOfFloat ?? null,
    daysToCover: stats.shortRatio ?? null,
    sharesShort: stats.sharesShort ?? null,
    sharesShortPrior: stats.sharesShortPriorMonth ?? null,
  };
  // Drop names with no usable trend or breadth.
  if (snap.cyNow == null && snap.nyNow == null && snap.up30d == null && snap.down30d == null) return null;
  return snap;
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

  console.log(`Fetching estimate revisions for ${symbols.length} symbols${onlyUniverse ? ` (${onlyUniverse})` : ""}…`);
  const names: Record<string, EstSnap> = {};
  let done = 0, ok = 0;
  await mapPool(symbols, 5, async (sym) => {
    try {
      const stats = await getCompanyStats(sym);
      if (stats) {
        const es = extract(stats);
        if (es) { names[sym] = es; ok++; }
      }
    } catch {
      /* skip a bad name */
    }
    if (++done % 50 === 0) console.log(`  ${done}/${symbols.length} (${ok} with data)`);
  });
  console.log(`  got ${ok}/${symbols.length}`);

  if (explicit.length) {
    for (const s of symbols) console.log(`${s}: ${JSON.stringify(names[s] ?? null)}`);
    return;
  }

  const out: EstimatesFile = { generatedAt: new Date().toISOString(), asOf: new Date().toISOString().slice(0, 10), names };
  const outPath = path.join(DATA_DIR, "estimates.json");
  // Merge with the existing file so an --only run doesn't drop other universes' names.
  if (onlyUniverse) {
    try {
      const existing = JSON.parse(await fs.readFile(outPath, "utf8")) as EstimatesFile;
      const thisSet = new Set(symbols);
      const kept: Record<string, EstSnap> = {};
      for (const [k, v] of Object.entries(existing.names)) if (!thisSet.has(k)) kept[k] = v;
      out.names = { ...kept, ...names };
    } catch {
      /* no existing file */
    }
  }
  await fs.writeFile(outPath, JSON.stringify(out));
  console.log(`Wrote ${outPath} (${Object.keys(out.names).length} names)`);
}

main().catch((e) => { console.error(e); process.exit(1); });
