/**
 * refresh-real-economy — free "real economy" alt-data that leads the hard macro prints: freight (rail
 * carloads + intermodal, a truck-freight index), air-travel demand (TSA daily throughput), and housing
 * (starts, permits, construction spend), plus a lodging-CPI hotel PROXY.
 *
 * All free, no license: FRED (fredgraph, keyless) for the monthly index series, TSA's public
 * checkpoint-throughput page for daily air travel. Hotel is a lodging-away CPI proxy, NOT STR RevPAR
 * (which is licensed) — labeled as such. Writes data/real-economy.json; the Macro page renders it.
 *
 * Runs on the FULL tick (run-tick.ts) + refresh-data.yml. Degrades to STALE, never EMPTY
 * (writeFeedGuarded): a FRED outage keeps the prior file rather than blanking the panel.
 *
 *   npx tsx scripts/refresh-real-economy.ts
 */
import * as cheerio from "cheerio";
import { fetchSeries } from "../lib/fred";
import { writeFeedGuarded } from "../lib/feedGuard";
import type { RealEcoSeries, TsaThroughput, RealEconomyData, RealEcoGroup } from "../lib/realEconomy";

const COSD = new Date(Date.now() - 6 * 365 * 86_400_000).toISOString().slice(0, 10); // ~6yr of history

const FRED: { key: string; id: string; label: string; group: RealEcoGroup; unit: string; source: string; note?: string }[] = [
  { key: "rail-carloads", id: "RAILFRTCARLOADSD11", label: "Rail carloads", group: "Freight", unit: "carloads/mo", source: "FRED · AAR (SA)" },
  { key: "rail-intermodal", id: "RAILFRTINTERMODALD11", label: "Rail intermodal", group: "Freight", unit: "units/mo", source: "FRED · AAR (SA)" },
  { key: "truck-freight-tsi", id: "TSIFRGHT", label: "Freight index (truck-heavy)", group: "Freight", unit: "index", source: "FRED · BTS Freight TSI", note: "Free public stand-in for the proprietary ATA Truck Tonnage Index" },
  { key: "hotel-lodging-cpi", id: "CUSR0000SEHB", label: "Lodging-away CPI", group: "Travel", unit: "CPI index", source: "FRED · BLS", note: "Hotel PRICE proxy — NOT STR RevPAR (no occupancy/revenue)" },
  { key: "housing-starts", id: "HOUST", label: "Housing starts", group: "Housing", unit: "k units SAAR", source: "FRED · Census" },
  { key: "building-permits", id: "PERMIT", label: "Building permits", group: "Housing", unit: "k units SAAR", source: "FRED · Census" },
  { key: "construction-spend", id: "TTLCONS", label: "Construction spending", group: "Housing", unit: "$M SAAR", source: "FRED · Census" },
];

const pct = (a: number | null, b: number | null): number | null =>
  a != null && b != null && b !== 0 ? (a / b - 1) * 100 : null;

function buildSeries(cfg: (typeof FRED)[number], obs: { date: string; value: number }[]): RealEcoSeries | null {
  if (!obs.length) return null;
  const latestObs = obs[obs.length - 1];
  const prevObs = obs.length >= 2 ? obs[obs.length - 2] : null;
  // ~12 months before the latest period, the last obs on-or-before that target.
  const yearTargetMs = Date.parse(latestObs.date) - 365 * 86_400_000;
  let yearAgoObs: { date: string; value: number } | null = null;
  for (const o of obs) { if (Date.parse(o.date) <= yearTargetMs) yearAgoObs = o; else break; }
  return {
    key: cfg.key, label: cfg.label, group: cfg.group, unit: cfg.unit, seriesId: cfg.id, source: cfg.source, note: cfg.note,
    latest: latestObs.value, latestDate: latestObs.date,
    prev: prevObs?.value ?? null, yearAgo: yearAgoObs?.value ?? null,
    momPct: pct(latestObs.value, prevObs?.value ?? null),
    yoyPct: pct(latestObs.value, yearAgoObs?.value ?? null),
    history: obs.slice(-60).map((o) => [o.date, o.value] as [string, number]),
  };
}

/** TSA daily checkpoint throughput — the public YTD table at tsa.gov (now a 2-column Date | Numbers
 *  list, current year only, so there's no prior-year column for a true YoY). Best-effort: any parse
 *  failure → null (the FRED series are the robust core; TSA is a bonus daily air-travel signal). */
async function fetchTsa(): Promise<TsaThroughput | null> {
  try {
    const res = await fetch("https://www.tsa.gov/travel/passenger-volumes", { headers: { "User-Agent": "stock-chart-screener (research)" }, signal: AbortSignal.timeout(20_000) });
    if (!res.ok) return null;
    const $ = cheerio.load(await res.text());
    const rows: [string, number][] = []; // [YYYY-MM-DD, passengers]
    $("table tr").each((_, tr) => {
      const tds = $(tr).find("td");
      if (tds.length !== 2) return;
      const m = $(tds[0]).text().trim().match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); // M/D/YYYY
      if (!m) return;
      const v = parseInt($(tds[1]).text().replace(/[^0-9]/g, ""), 10);
      if (!Number.isFinite(v)) return;
      rows.push([`${m[3]}-${m[1].padStart(2, "0")}-${m[2].padStart(2, "0")}`, v]);
    });
    if (!rows.length) return null;
    rows.sort((a, b) => Date.parse(a[0]) - Date.parse(b[0])); // oldest→newest
    const vals = rows.map((r) => r[1]);
    const avgOf = (a: number[]) => (a.length ? a.reduce((s, v) => s + v, 0) / a.length : null);
    const avg7 = avgOf(vals.slice(-7));
    const prev7 = rows.length >= 37 ? avgOf(vals.slice(-37, -30)) : null; // 7-day window ~1 month earlier
    return {
      latestDate: rows[rows.length - 1][0],
      latest: rows[rows.length - 1][1],
      avg7, prev7, chg30dPct: pct(avg7, prev7),
      history: rows.slice(-120),
      source: "TSA checkpoint throughput (YTD)",
    };
  } catch {
    return null;
  }
}

async function main() {
  const series: RealEcoSeries[] = [];
  for (const cfg of FRED) {
    const obs = await fetchSeries(cfg.id, COSD).catch(() => []);
    const s = buildSeries(cfg, obs);
    if (s) { series.push(s); console.log(`  ${cfg.key.padEnd(20)} ${s.latest} @ ${s.latestDate}  (YoY ${s.yoyPct?.toFixed(1) ?? "—"}%)`); }
    else console.warn(`  ${cfg.key.padEnd(20)} no data (kept out of this run)`);
  }
  const tsa = await fetchTsa();
  console.log(tsa ? `  tsa                  ${tsa.latest} @ ${tsa.latestDate}  (7d-avg vs 1mo ${tsa.chg30dPct?.toFixed(1) ?? "—"}%)` : "  tsa                  unavailable (best-effort)");

  const data: RealEconomyData = { asOf: new Date().toISOString(), series, tsa };
  const w = await writeFeedGuarded("real-economy.json", data);
  console.log(`refresh-real-economy: ${w.reason}`);
  if (!w.written) { console.error("refresh-real-economy: kept prior file (this run was too thin) — will retry next tick."); process.exitCode = 1; }
}

main().catch((e) => { console.error("refresh-real-economy:", String((e as Error)?.message || e)); process.exitCode = 1; });
