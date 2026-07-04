/**
 * Vol Dislocation snapshot — derives a cross-sectional vol read from data/putwrite.json (already produced
 * nightly by refresh-putwrite.ts, which solves an ATM IV + two-tenor IVs + realized vol per name). NO new
 * option fetches — pure transform. Run AFTER refresh-putwrite in the nightly FULL job.
 *
 * Per name: variance premium (atmIV/rvol), term crush (front/back IV), skew (put−call IV), IV-rank, and an
 * earnings-driven flag (rich vol that just reflects a print inside the front expiry — expected, not a
 * dislocation). Writes data/vol-dislocation.json, sorted richest-vol first.
 */
import { promises as fs } from "fs";
import path from "path";
import type { VolDisRow, VolDisData } from "../lib/volDislocation";

async function main() {
  const raw = await fs.readFile(path.join(process.cwd(), "data", "putwrite.json"), "utf8").catch(() => null);
  if (!raw) {
    console.error("vol-dislocation: no data/putwrite.json — run `npm run refresh-putwrite` first.");
    process.exit(1);
  }
  const pw = JSON.parse(raw) as { candidates?: any[]; filters?: any };
  const cands = pw.candidates || [];
  const now = Date.now();
  const rows: VolDisRow[] = [];
  for (const c of cands) {
    // Floor the inputs: a <8% realized vol (or a <8% ATM IV) on a quality large-cap is almost always a
    // data glitch, and a near-zero denominator turns the IV/RV ratio into meaningless noise (6x+ artifacts).
    if (!(c.atmIV >= 0.08) || !(c.rvol >= 0.08) || c.ivPremium == null) continue;
    const m1iv = c.puts?.m1?.iv ?? null,
      m3iv = c.puts?.m3?.iv ?? null,
      callM1 = c.calls?.m1?.iv ?? null,
      dte1 = c.puts?.m1?.dte ?? null;
    const termCrush = m1iv != null && m3iv != null && m3iv > 0 ? +(m1iv / m3iv).toFixed(3) : null;
    const skew = m1iv != null && callM1 != null ? +(m1iv - callM1).toFixed(4) : null;
    const de = c.nextEarnings && !Number.isNaN(Date.parse(c.nextEarnings)) ? Math.round((Date.parse(c.nextEarnings) - now) / 86_400_000) : null;
    const earningsDriven = de != null && de >= 0 && dte1 != null && de <= dte1 + 2; // earnings inside the front expiry
    rows.push({
      symbol: c.symbol,
      name: c.name,
      sector: c.sector,
      price: c.price,
      marketCap: c.marketCap,
      atmIV: c.atmIV,
      rvol: c.rvol,
      ivPremium: c.ivPremium,
      termCrush,
      skew,
      ivRank: c.ivRank ?? null,
      rvolRank: c.rvolRank ?? null,
      daysToEarnings: de,
      earningsDriven,
      pctile: 0,
    });
  }
  // cross-sectional percentile of the variance premium
  const byPrem = [...rows].sort((a, b) => a.ivPremium - b.ivPremium);
  const n = byPrem.length;
  byPrem.forEach((r, i) => (r.pctile = Math.round((i / Math.max(1, n - 1)) * 100)));
  rows.sort((a, b) => b.ivPremium - a.ivPremium); // richest vol first

  const out: VolDisData = {
    generatedAt: new Date().toISOString(),
    universe: "US quality large/mid-caps (put-writing set)",
    scanned: rows.length,
    rows,
  };
  await fs.writeFile(path.join(process.cwd(), "data", "vol-dislocation.json"), JSON.stringify(out));
  const rich = rows.filter((r) => r.ivPremium >= 1.4).length,
    cheap = rows.filter((r) => r.ivPremium <= 1.1).length;
  console.log(`vol-dislocation: ${rows.length} names · rich (IV/RV≥1.4): ${rich} · cheap (≤1.1): ${cheap}`);
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
