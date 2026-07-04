/**
 * Builds data/seasonality.json — the earnings-move amplifier per name (see lib/seasonality for the doctrine
 * + the APPROXIMATE caveat). For each quality name: fetch its recent earnings reactions (getEarningsReactions
 * = EDGAR 8-K dates + Yahoo chart) and its realized vol (LOCAL series) → avg |move| vs a normal day.
 * Globally rate-limited. Run in the nightly FULL job. SEASON_TOP caps the universe (default 200 by cap).
 */
import { promises as fs } from "fs";
import path from "path";
import { loadSymbolSeries } from "../lib/data";
import { realizedVol } from "../lib/putwrite";
import { getEarningsReactions } from "../lib/earningsReaction";
import type { SeasonRow, SeasonData } from "../lib/seasonality";

const DATA = path.join(process.cwd(), "data");
const TOP = Number(process.env.SEASON_TOP || 200);
const MIN_N = 4;

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

async function mapPool<T, R2>(items: T[], n: number, fn: (x: T) => Promise<R2>): Promise<R2[]> {
  const out: R2[] = new Array(items.length);
  let idx = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (idx < items.length) {
        const i = idx++;
        try { out[i] = await fn(items[i]); } catch { out[i] = null as any; }
      }
    }),
  );
  return out;
}

let gate: Promise<void> = Promise.resolve();
function throttle(gap = 300): Promise<void> {
  const p = gate.then(() => sleep(gap));
  gate = p;
  return p;
}

async function main() {
  const pwRaw = await fs.readFile(path.join(DATA, "putwrite.json"), "utf8").catch(() => null);
  if (!pwRaw) {
    console.error("seasonality: no data/putwrite.json — run `npm run refresh-putwrite` first.");
    process.exit(1);
  }
  const pw = JSON.parse(pwRaw) as { candidates?: any[] };
  const pool = (pw.candidates || [])
    .filter((c) => c.symbol && c.marketCap > 0)
    .sort((a, b) => b.marketCap - a.marketCap)
    .slice(0, TOP);
  console.log(`seasonality: scanning ${pool.length} quality names for the earnings amplifier`);

  const built = await mapPool(pool, 6, async (c: any): Promise<SeasonRow | null> => {
    const series = await loadSymbolSeries(c.symbol);
    let dailyMove: number | null = null;
    if (series?.daily?.length) {
      const closes = series.daily.map((d: any) => (Array.isArray(d) ? d[1] : d.c)).filter((x: number) => Number.isFinite(x) && x > 0);
      const rv = realizedVol(closes, 20);
      if (rv != null && rv > 0) dailyMove = rv / Math.sqrt(252); // annualized → 1-day σ
    }
    if (dailyMove == null || !(dailyMove > 0)) return null;

    await throttle();
    const reacts = await getEarningsReactions(c.symbol, 12).catch(() => []);
    const moves = reacts.map((r) => r.move).filter((m): m is number => m != null && Number.isFinite(m));
    if (moves.length < MIN_N) return null;
    const abs = moves.map((m) => Math.abs(m));
    const avgAbs = abs.reduce((a, b) => a + b, 0) / abs.length;
    const upBias = moves.reduce((a, b) => a + b, 0) / moves.length;
    const bigRate = abs.filter((m) => m > 2 * dailyMove!).length / abs.length;
    const drifts = reacts.map((r) => r.drift5).filter((d): d is number => d != null && Number.isFinite(d));
    const avgDrift5 = drifts.length ? drifts.reduce((a, b) => a + b, 0) / drifts.length : null;
    return {
      symbol: c.symbol,
      name: c.name,
      sector: c.sector || "—",
      n: moves.length,
      avgAbsMovePct: +(avgAbs * 100).toFixed(2),
      dailyMovePct: +(dailyMove * 100).toFixed(2),
      amplifier: +(avgAbs / dailyMove).toFixed(2),
      bigRate: +bigRate.toFixed(2),
      upBias: +(upBias * 100).toFixed(2),
      avgDrift5: avgDrift5 != null ? +(avgDrift5 * 100).toFixed(2) : null,
    };
  });

  const rows = built.filter((r): r is SeasonRow => !!r).sort((a, b) => b.amplifier - a.amplifier);
  const out: SeasonData = { generatedAt: new Date().toISOString(), scanned: rows.length, rows };
  await fs.writeFile(path.join(DATA, "seasonality.json"), JSON.stringify(out));
  console.log(`seasonality: ${rows.length} names · top amplifier ${rows[0]?.symbol} ${rows[0]?.amplifier}× · quietest ${rows[rows.length - 1]?.symbol} ${rows[rows.length - 1]?.amplifier}×`);
}

main().catch((e) => { console.error(String(e?.message || e)); process.exit(1); });
