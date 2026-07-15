/**
 * Vol Dislocation snapshot — derives a cross-sectional vol read from data/putwrite.json (already produced
 * nightly by refresh-putwrite.ts, which solves an ATM IV + two-tenor IVs + realized vol per name). NO new
 * option fetches — pure transform. Run AFTER refresh-putwrite in the nightly FULL job.
 *
 * Per name: variance premium (atmIV/rvol), term crush (front/back IV), skew (put−call IV), IV-rank, and an
 * earnings-driven flag (rich vol that just reflects a print inside the front expiry — expected, not a
 * dislocation). Writes data/vol-dislocation.json, sorted richest-vol first.
 */
import { writeFeedGuarded } from "../lib/feedGuard";
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
      sectorPremium: null,
      vsSector: null,
      pctile: 0,
      illiquid: false,
      broad: false,
    });
  }

  // Merge in the BROAD vol-universe probe (R1000/R3000 — scripts/refresh-vol-universe.ts), preferring the
  // richer put-writing rows where a name is in both. This widens coverage well beyond the ~380 quality
  // names; small/thin-option names carry an `illiquid` flag so the view can down-weight or hide them.
  const have = new Set(rows.map((r) => r.symbol));
  let broadN = 0;
  try {
    const vu = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "vol-universe.json"), "utf8")) as { rows?: any[] };
    for (const r of vu.rows || []) {
      if (!r || have.has(r.symbol)) continue;
      if (!(r.atmIV >= 0.08) || !(r.rvol >= 0.08) || r.ivPremium == null) continue;
      have.add(r.symbol);
      broadN++;
      rows.push({
        symbol: r.symbol,
        name: r.name,
        sector: r.sector || "—",
        price: r.price,
        marketCap: r.marketCap,
        atmIV: r.atmIV,
        rvol: r.rvol,
        ivPremium: r.ivPremium,
        termCrush: r.termCrush ?? null,
        skew: r.skew ?? null,
        ivRank: r.ivRank ?? null,
        rvolRank: r.rvolRank ?? null,
        daysToEarnings: r.daysToEarnings ?? null,
        earningsDriven: !!r.earningsDriven,
        sectorPremium: null,
        vsSector: null,
        pctile: 0,
        illiquid: !!r.illiquid,
        broad: true,
      });
    }
  } catch { /* missing OR corrupt vol-universe.json → screener runs on the putwrite quality set alone */ }

  // cross-sectional percentile of the variance premium
  const byPrem = [...rows].sort((a, b) => a.ivPremium - b.ivPremium);
  const n = byPrem.length;
  byPrem.forEach((r, i) => (r.pctile = Math.round((i / Math.max(1, n - 1)) * 100)));
  // peer-relative: each name's variance premium vs its SECTOR's median (the peer baseline). A name at
  // 1.5x in a sector where everyone's at 1.5x isn't special; at 1.5x where the sector's at 1.1x, it is.
  const bySector = new Map<string, number[]>();
  for (const r of rows) {
    if (!r.sector || r.illiquid) continue; // thin-option names carry junk IV — keep them out of the peer baseline
    const a = bySector.get(r.sector);
    if (a) a.push(r.ivPremium);
    else bySector.set(r.sector, [r.ivPremium]);
  }
  const sectorMed = new Map<string, number>();
  for (const [s, arr] of bySector) {
    if (arr.length >= 3) {
      const srt = [...arr].sort((a, b) => a - b);
      sectorMed.set(s, srt[Math.floor(srt.length / 2)]);
    }
  }
  for (const r of rows) {
    const med = r.sector ? sectorMed.get(r.sector) : undefined;
    r.sectorPremium = med != null ? +med.toFixed(2) : null;
    r.vsSector = med != null ? +(r.ivPremium - med).toFixed(2) : null;
  }
  rows.sort((a, b) => b.ivPremium - a.ivPremium); // richest vol first

  const out: VolDisData = {
    generatedAt: new Date().toISOString(),
    universe: broadN > 0 ? "US large/mid-caps (put-writing quality set + broad R1000/R3000 probe)" : "US quality large/mid-caps (put-writing set)",
    scanned: rows.length,
    rows,
  };
  // Guarded: a vendor-outage night must leave the prior board stale, not blank (see lib/feedGuard).
  const w = await writeFeedGuarded("vol-dislocation.json", out);
  if (!w.written) { console.error(`refresh-vol-dislocation: WRITE BLOCKED — ${w.reason}`); process.exit(1); }
  const rich = rows.filter((r) => r.ivPremium >= 1.4).length,
    cheap = rows.filter((r) => r.ivPremium <= 1.1).length;
  console.log(`vol-dislocation: ${rows.length} names (${broadN} from the broad probe) · rich (IV/RV≥1.4): ${rich} · cheap (≤1.1): ${cheap}`);
}

main().catch((e) => {
  console.error(String(e?.message || e));
  process.exit(1);
});
