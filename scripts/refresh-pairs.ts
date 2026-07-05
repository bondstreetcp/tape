/**
 * Pairs / relative-value stat-arb screener — finds the most STRETCHED same-sector, mean-reverting pairs
 * in the S&P 500 (cap-weighted top names per sector) from the stored daily price series. For each pair it
 * fits a hedge ratio, forms the log-price spread, and reports the spread z-score (how far it's stretched),
 * the OU half-life (how fast it reverts), and the return correlation. Writes data/pairs.json (nightly).
 * US single-stock names → the page is US-gated. Math + filters live in lib/pairs.ts (unit-tested).
 */
import { promises as fs } from "fs";
import path from "path";
import { findPairs, type Daily, type PairsData, type PairRow } from "../lib/pairs";

const DATA = path.join(process.cwd(), "data");

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
  const snap = JSON.parse(await fs.readFile(path.join(DATA, "sp500", "snapshot.json"), "utf8"));
  const stocks: Stock[] = (snap.stocks ?? []).filter((s: Stock) => s.symbol && s.marketCap && s.sector);
  const byId = new Map(stocks.map((s) => [s.symbol, s]));

  const series = new Map<string, Daily>();
  for (const s of stocks) {
    const d = await loadSeries(s.symbol);
    if (d && d.length >= 120) series.set(s.symbol, d);
  }
  console.log(`pairs: loaded ${series.size}/${stocks.length} series with ≥120 days`);

  const names = [...series.keys()];
  const pairs = findPairs(
    names,
    series,
    (s) => byId.get(s)?.sector || "—",
    (s) => byId.get(s)?.marketCap || 0,
    { maxPerSector: 30, topN: 80 },
  );

  const rows: PairRow[] = pairs.map((p) => ({
    ...p,
    nameA: byId.get(p.a)?.name ?? p.a,
    nameB: byId.get(p.b)?.name ?? p.b,
    priceA: byId.get(p.a)?.price ?? null,
    priceB: byId.get(p.b)?.price ?? null,
  }));

  const out: PairsData = { generatedAt: new Date().toISOString(), universe: "S&P 500", scanned: series.size, pairs: rows };
  await fs.writeFile(path.join(DATA, "pairs.json"), JSON.stringify(out));
  console.log(`pairs: wrote ${rows.length} stretched pairs → data/pairs.json`);
  for (const p of rows.slice(0, 10)) console.log(`  ${p.a}/${p.b} [${p.sector}] z=${p.z.toFixed(2)} hl=${p.halfLifeDays?.toFixed(0)}d corr=${p.corr.toFixed(2)} β=${p.beta.toFixed(2)}`);
}

main().catch((e) => { console.error("pairs:", String(e?.message || e)); process.exit(1); });
