/**
 * Pairs / relative-value stat-arb screener — UNIVERSE-WIDE (Russell 3000, cap-capped per sector).
 *
 * From the stored daily price series it runs one same-sector scan (lib/pairs.scanPairs) that emits
 * BOTH signals from a single alignment per pair:
 *   • STRETCHED — correlated, mean-reverting pairs whose log-price spread is |z|≥2 wide (a convergence
 *     trade): hedge ratio + OU half-life + spread z.
 *   • DECOUPLED — pairs that moved together over the past year (corrLong high) whose correlation just
 *     collapsed (corrShort low): the co-movement BROKE, usually a single-name catalyst on one leg.
 *
 * This is a compute-over-owned-data job (no network) — the NAS's sweet spot: the whole price panel is
 * RAM-resident. A wall-clock budget (PAIRS_BUDGET_MIN, default 15, well under run-tick's 45m cap)
 * bounds the O(k²)/sector scan on the weak CPU; per-sector liquidity caps keep it to tradeable names.
 * Writes data/pairs.json (nightly). US single-stock → the page is US-gated. Math + filters live in
 * lib/pairs.ts (unit-tested).
 */
import { promises as fs } from "fs";
import path from "path";
import { scanPairs, bucketByDay, type Daily, type PairsData, type PairRow, type DecoupledRow } from "../lib/pairs";
import type { Snapshot } from "../lib/types";

const DATA = path.join(process.cwd(), "data");
const OUT = path.join(DATA, "pairs.json");
const BUDGET_MIN = Number(process.env.PAIRS_BUDGET_MIN || 15);
const MAX_PER_SECTOR = Number(process.env.PAIRS_MAX_PER_SECTOR || 120);
// A series whose last bar is older than this is stale/halted — excluded so the recency-based
// DECOUPLED signal ("the correlation broke in the last month") can't fire on a frozen tail, and so a
// laggard leg can't drag a pair's aligned window back in time. 10d tolerates weekends + holidays;
// a liquid name (we cap per-sector by cap) trades every session, so a longer gap is a data problem.
const MAX_STALE_DAYS = Number(process.env.PAIRS_MAX_STALE_DAYS || 10);

// Broadest-first: russell3000 is the superset; later universes only add names it lacks (foreign-
// incorporated S&P names, etc.). First snapshot wins per symbol → one liquidity/sector record each.
const US_UNIVERSES = ["russell3000", "sp1500", "russell1000", "sp500", "nasdaq100"] as const;

interface Stock { symbol: string; name: string; sector?: string; marketCap?: number; price?: number }

async function loadSeries(sym: string): Promise<Daily | null> {
  try {
    const j = JSON.parse(await fs.readFile(path.join(DATA, "series", "symbols", sym + ".json"), "utf8"));
    return Array.isArray(j?.daily) ? (j.daily as Daily) : null;
  } catch {
    return null;
  }
}

async function main() {
  // Union of the US universes — the broadest set of single-stock names with a sector + market cap.
  const byId = new Map<string, Stock>();
  for (const u of US_UNIVERSES) {
    let snap: Snapshot | null = null;
    try { snap = JSON.parse(await fs.readFile(path.join(DATA, u, "snapshot.json"), "utf8")) as Snapshot; } catch { continue; }
    for (const s of (snap.stocks ?? []) as Stock[]) {
      if (s.symbol && s.marketCap && s.sector && !byId.has(s.symbol)) byId.set(s.symbol, s);
    }
  }
  const stocks = [...byId.values()];
  if (!stocks.length) { console.error("pairs: no readable US snapshots — keeping the prior pairs.json (degrade to STALE, never EMPTY)."); process.exit(1); }
  console.log(`pairs: ${stocks.length} US names across ${US_UNIVERSES.length} universes`);

  // Load + day-bucket every series ONCE (bucketByDay floors to UTC midnight so two names align on a
  // common day axis — robust vs intraday-timestamp drift, and computed a single time, not per pair).
  const staleCutoff = Date.now() - MAX_STALE_DAYS * 86_400_000;
  const series = new Map<string, Daily>();
  let stale = 0;
  for (const s of stocks) {
    const d = await loadSeries(s.symbol);
    if (!d || d.length < 120) continue;
    const b = bucketByDay(d);
    if (b.length < 120) continue;
    if (b[b.length - 1][0] < staleCutoff) { stale++; continue; } // last bar too old → don't pair it
    series.set(s.symbol, b);
  }
  console.log(`pairs: loaded ${series.size}/${stocks.length} series with ≥120 daily bars (${stale} skipped stale >${MAX_STALE_DAYS}d)`);
  if (!series.size) { console.error("pairs: no fresh series loaded — keeping the prior pairs.json."); process.exit(1); }

  const deadlineMs = Date.now() + BUDGET_MIN * 60_000;
  const t0 = Date.now();
  const { stretched, decoupled, pairsTested, truncated } = scanPairs(
    [...series.keys()],
    series,
    (s) => byId.get(s)?.sector || "—",
    (s) => byId.get(s)?.marketCap || 0,
    { maxPerSector: MAX_PER_SECTOR, topN: 120, decoupledTopN: 60, deadlineMs },
  );
  const secs = ((Date.now() - t0) / 1000).toFixed(0);
  console.log(`pairs: scanned ${pairsTested} same-sector pairs in ${secs}s${truncated ? ` · ⚠ BUDGET (${BUDGET_MIN}m) HIT — partial scan` : ""}`);

  const enrich = (a: string, b: string) => ({
    nameA: byId.get(a)?.name ?? a, nameB: byId.get(b)?.name ?? b,
    priceA: byId.get(a)?.price ?? null, priceB: byId.get(b)?.price ?? null,
  });
  const pairs: PairRow[] = stretched.map((p) => ({ ...p, ...enrich(p.a, p.b) }));
  const decoupledRows: DecoupledRow[] = decoupled.map((d) => ({ ...d, ...enrich(d.a, d.b) }));

  // Degrade to STALE, never EMPTY: if this run found nothing but the prior file had rows, something
  // upstream broke (not a genuinely empty market across 2,600 names) — keep the prior board.
  if (!pairs.length && !decoupledRows.length) {
    const priorHad = await fs.readFile(OUT, "utf8")
      .then((s) => { const j = JSON.parse(s) as PairsData; return (j.pairs?.length ?? 0) + (j.decoupled?.length ?? 0) > 0; })
      .catch(() => false);
    if (priorHad) { console.error("pairs: scan produced 0 rows but the prior file has data — keeping it (degrade to STALE)."); process.exit(1); }
  }

  const out: PairsData = {
    generatedAt: new Date().toISOString(),
    universe: "Russell 3000",
    scanned: series.size,
    pairs,
    decoupled: decoupledRows,
  };
  await fs.writeFile(OUT, JSON.stringify(out));
  console.log(`pairs: wrote ${pairs.length} stretched + ${decoupledRows.length} decoupled → data/pairs.json`);
  for (const p of pairs.slice(0, 6)) console.log(`  stretched ${p.a}/${p.b} [${p.sector}] z=${p.z.toFixed(2)} hl=${p.halfLifeDays?.toFixed(0)}d corr=${p.corr.toFixed(2)}`);
  for (const d of decoupledRows.slice(0, 6)) console.log(`  decoupled ${d.a}/${d.b} [${d.sector}] corr ${d.corrLong.toFixed(2)}→${d.corrShort.toFixed(2)} (drop ${d.drop.toFixed(2)}) · broke ${d.broke} ${d.brokeMovePct >= 0 ? "+" : ""}${d.brokeMovePct}%`);
}

main().catch((e) => { console.error("pairs:", String(e?.message || e)); process.exit(1); });
