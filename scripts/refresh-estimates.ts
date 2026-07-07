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
const SHORT_HIST = path.join(DATA_DIR, "short-history.json");
const DAY = 86_400_000;

// Yahoo DROPPED sharesShortPriorMonth (it's null for every name now), so the "Shorts MoM" column was
// always blank. We keep our OWN rolling short-interest history and diff it: append each run's reading,
// and pick the reading closest to ~30 days ago as the prior. Forward-accumulating — the MoM populates
// once ~a month of history exists (we can't fabricate a prior we never captured).
type ShortHist = Record<string, { d: string; s: number }[]>; // per symbol, oldest→newest
async function loadShortHistory(): Promise<ShortHist> {
  return fs.readFile(SHORT_HIST, "utf8").then((s) => JSON.parse(s) as ShortHist).catch(() => ({}));
}
/** The stored reading closest to ~30d before `today`, within a 12–75 day window (a "prior month"). */
function priorShort(hist: { d: string; s: number }[] | undefined, today: number): number | null {
  if (!hist?.length) return null;
  let best: number | null = null, bestGap = Infinity;
  for (const h of hist) {
    const age = (today - Date.parse(h.d + "T00:00:00Z")) / DAY;
    if (age < 12 || age > 75) continue;
    const gap = Math.abs(age - 30);
    if (gap < bestGap) { bestGap = gap; best = h.s; }
  }
  return best;
}
/** Append today's reading (only if it's a new value or ≥10d since the last), keep ~8 per symbol. */
function pushShort(hist: ShortHist, sym: string, today: string, shares: number): void {
  const arr = (hist[sym] ||= []);
  const last = arr[arr.length - 1];
  const ageDays = last ? (Date.parse(today) - Date.parse(last.d)) / DAY : Infinity;
  if (last && last.s === shares && ageDays < 20) return; // unchanged & recent → don't bloat
  if (last && ageDays < 10) { last.d = today; last.s = shares; return; } // same reading period → update in place
  arr.push({ d: today, s: shares });
  if (arr.length > 8) arr.splice(0, arr.length - 8);
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

function extract(stats: CompanyStats, priorShares: number | null): EstSnap | null {
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
    // Prefer Yahoo's prior-month if it ever returns again; otherwise our own persisted history.
    sharesShortPrior: stats.sharesShortPriorMonth ?? priorShares ?? null,
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

  const shortHist = await loadShortHistory();
  const nowMs = Date.now();
  const todayStr = new Date(nowMs).toISOString().slice(0, 10);

  console.log(`Fetching estimate revisions for ${symbols.length} symbols${onlyUniverse ? ` (${onlyUniverse})` : ""}…`);
  const names: Record<string, EstSnap> = {};
  let done = 0, ok = 0, momN = 0;
  await mapPool(symbols, 5, async (sym) => {
    try {
      const stats = await getCompanyStats(sym);
      if (stats) {
        const prior = priorShort(shortHist[sym], nowMs);
        const es = extract(stats, prior);
        if (es) {
          names[sym] = es;
          ok++;
          if (prior != null && es.sharesShort != null) momN++;
          if (stats.sharesShort != null && stats.sharesShort > 0) pushShort(shortHist, sym, todayStr, stats.sharesShort);
        }
      }
    } catch {
      /* skip a bad name */
    }
    if (++done % 50 === 0) console.log(`  ${done}/${symbols.length} (${ok} with data)`);
  });
  console.log(`  got ${ok}/${symbols.length} · ${momN} with a short-interest MoM prior`);

  if (explicit.length) {
    for (const s of symbols) console.log(`${s}: ${JSON.stringify(names[s] ?? null)}`);
    return;
  }

  // Persist the short-interest history (forward-accumulating; how the MoM column fills over time).
  await fs.writeFile(SHORT_HIST, JSON.stringify(shortHist));

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
