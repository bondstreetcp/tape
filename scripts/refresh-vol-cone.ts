/**
 * Builds data/vol-cone.json — the realized-vol cone screener. For every name across EVERY universe
 * (US + international) it computes the annualized realized-vol cone (lib/volCone) from the stored price
 * series and stores the compact feed row (headline 21d RV + its percentile in own history, the 21d cone
 * bounds, 63d + 1y RV, term slope). Pure LOCAL math — no network, no LLM — so it can score the whole
 * cross-universe roster cheaply. Nightly FULL (after the snapshots/series are current).
 */
import { writeFeedGuarded } from "../lib/feedGuard";
import { promises as fs } from "fs";
import path from "path";
import { loadSnapshot, loadSymbolSeries } from "../lib/data";
import { UNIVERSE_IDS } from "../lib/universes";
import { buildVolCone, toFeedRow, CONE_HORIZONS, type VolConeData, type VolConeFeedRow, type Daily } from "../lib/volCone";

const DATA = path.join(process.cwd(), "data");
const WORKERS = 16;

async function mapPool<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
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

async function main() {
  // Union of every universe's constituents (a name in several universes is scored once).
  const meta = new Map<string, { name: string; sector: string }>();
  for (const u of UNIVERSE_IDS) {
    const snap = await loadSnapshot(u);
    for (const s of snap?.stocks ?? []) {
      const sym = s.symbol?.toUpperCase();
      if (sym && !meta.has(sym)) meta.set(sym, { name: s.name || sym, sector: s.sector || "—" });
    }
  }
  const syms = [...meta.keys()];
  console.log(`vol-cone: scoring ${syms.length} names across ${UNIVERSE_IDS.length} universes (local series only)`);

  const built = await mapPool(syms, WORKERS, async (sym): Promise<VolConeFeedRow | null> => {
    const series = await loadSymbolSeries(sym);
    const daily = series?.daily;
    if (!Array.isArray(daily) || daily.length < 60) return null;
    const m = meta.get(sym)!;
    const row = buildVolCone(sym, m.name, m.sector, daily as Daily);
    return row ? toFeedRow(row) : null;
  });

  const rows = built.filter((r): r is VolConeFeedRow => !!r).sort((a, b) => (a.pct20 ?? 999) - (b.pct20 ?? 999));
  if (rows.length < 100) { console.error(`vol-cone: only ${rows.length} names scored — aborting (keep previous file).`); process.exit(1); }

  const out: VolConeData = { generatedAt: new Date().toISOString(), horizons: [...CONE_HORIZONS], rows };
  // Round every vol/pct to keep the file small (fractions → 4dp, percentiles → 1dp is fine at 4dp too).
  const round = (_k: string, v: any) => (typeof v === "number" ? +v.toFixed(4) : v);
  const json = JSON.stringify(out, round);
  // Guarded: a vendor-outage night must leave the prior cone stale, not blank (see lib/feedGuard).
  const w = await writeFeedGuarded("vol-cone.json", out, { replacer: round });
  if (!w.written) { console.error(`refresh-vol-cone: WRITE BLOCKED — ${w.reason}`); process.exit(1); }
  const coiled = rows.filter((r) => r.pct20 != null && r.pct20 <= 20).length;
  const blown = rows.filter((r) => r.pct20 != null && r.pct20 >= 80).length;
  console.log(`vol-cone: wrote ${rows.length} rows (${coiled} coiled ≤20th pct, ${blown} blown-out ≥80th) · ${(json.length / 1e6).toFixed(2)} MB`);
}

main().catch((e) => { console.error("vol-cone:", String(e?.message || e)); process.exit(1); });
