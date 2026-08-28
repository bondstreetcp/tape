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
import { promises as fs } from "fs";
import path from "path";
import * as cheerio from "cheerio";
import { fetchSeries } from "../lib/fred";
import { writeFeedGuarded } from "../lib/feedGuard";
import { llmConfigured } from "../lib/llm";
import { buildRealEconomyRead } from "../lib/realEconomyRead";
import type { RealEcoSeries, TsaThroughput, RealEconomyData, RealEcoGroup } from "../lib/realEconomy";

const COSD = new Date(Date.now() - 21 * 365 * 86_400_000).toISOString().slice(0, 10); // ~21yr — deep enough for the detail view's 1Y/3Y/5Y/10Y/Max windows

type FredCfg = { key: string; id: string; label: string; group: RealEcoGroup; unit: string; source: string; note?: string; changeUnit?: "%" | "pts"; scale?: number; freq?: "M" | "W"; signLevel?: boolean; invert?: boolean };
const FRED: FredCfg[] = [
  // Activity — the broad, timely "how's the real economy" pulse (CFNAI monthly, WEI/NFCI weekly).
  { key: "cfnai", id: "CFNAI", label: "Chicago Fed activity (CFNAI)", group: "Activity", unit: "index · 0=trend", changeUnit: "pts", signLevel: true, source: "FRED · Chicago Fed", note: "85-indicator composite; >0 = above-trend growth" },
  { key: "wei", id: "WEI", label: "Weekly Economic Index", group: "Activity", unit: "% ann.", changeUnit: "pts", freq: "W", signLevel: true, source: "FRED · Dallas Fed (LMS)", note: "Weekly real-activity, scaled to GDP growth" },
  { key: "nfci", id: "NFCI", label: "Financial conditions (NFCI)", group: "Activity", unit: "index · 0=avg", changeUnit: "pts", freq: "W", invert: true, source: "FRED · Chicago Fed", note: "NEGATIVE = looser conditions" },
  { key: "chicago-cfsec", id: "CFSBCACTIVITY", label: "Chicago Fed survey (CFSEC)", group: "Activity", unit: "index · 0=trend", changeUnit: "pts", signLevel: true, source: "FRED · Chicago Fed", note: "District-7 business conditions; >0 = above-trend (free — not the licensed Chicago PMI)" },
  // Manufacturing / PMIs — regional Fed surveys are the FREE stand-in for the proprietary ISM PMI
  // (ISM had FRED discontinue its series). Diffusion indices: >0 = expansion, and a POINT move (not a
  // %) is the meaningful change. Plus hard output: industrial production, capacity use, core capex.
  { key: "pmi-empire", id: "GACDISA066MSFRBNY", label: "Empire State (NY Fed)", group: "Manufacturing", unit: "diffusion idx", changeUnit: "pts", signLevel: true, source: "FRED · NY Fed", note: "Free ISM-style survey; >0 = expansion" },
  { key: "pmi-philly", id: "GACDFSA066MSFRBPHI", label: "Philadelphia Fed", group: "Manufacturing", unit: "diffusion idx", changeUnit: "pts", signLevel: true, source: "FRED · Philly Fed", note: ">0 = expansion" },
  { key: "pmi-dallas", id: "BACTSAMFRBDAL", label: "Dallas Fed", group: "Manufacturing", unit: "diffusion idx", changeUnit: "pts", signLevel: true, source: "FRED · Dallas Fed", note: ">0 = expansion" },
  { key: "industrial-production", id: "INDPRO", label: "Industrial production", group: "Manufacturing", unit: "index 2017=100", source: "FRED · Federal Reserve" },
  { key: "capacity-util", id: "TCU", label: "Capacity utilization", group: "Manufacturing", unit: "%", source: "FRED · Federal Reserve" },
  { key: "core-capex", id: "NEWORDER", label: "Core capital-goods orders", group: "Manufacturing", unit: "$M SAAR", source: "FRED · Census", note: "Nondefense ex-aircraft — business investment demand" },

  // Services / non-manufacturing — the FREE stand-in for the proprietary ISM Services (services are
  // ~70% of the economy). Regional-Fed service-sector surveys; diffusion indices, >0 = expansion.
  { key: "svc-ny", id: "BACDINA066MNFRBNY", label: "NY Fed services", group: "Services", unit: "diffusion idx", changeUnit: "pts", signLevel: true, source: "FRED · NY Fed", note: "Business Leaders Survey; >0 = expansion (NSA)" },
  { key: "svc-philly", id: "GABNDIF066MSFRBPHI", label: "Philadelphia Fed services", group: "Services", unit: "diffusion idx", changeUnit: "pts", signLevel: true, source: "FRED · Philly Fed", note: "Nonmfg survey, firm activity; >0 = expansion" },
  { key: "svc-dallas", id: "TSSOSBACTSAMFRBDAL", label: "Dallas Fed services", group: "Services", unit: "diffusion idx", changeUnit: "pts", signLevel: true, source: "FRED · Dallas Fed", note: "Texas Service Sector; >0 = expansion" },
  // Freight
  { key: "rail-carloads", id: "RAILFRTCARLOADSD11", label: "Rail carloads", group: "Freight", unit: "carloads/mo", source: "FRED · AAR (SA)" },
  { key: "rail-intermodal", id: "RAILFRTINTERMODALD11", label: "Rail intermodal", group: "Freight", unit: "units/mo", source: "FRED · AAR (SA)" },
  { key: "truck-freight-tsi", id: "TSIFRGHT", label: "Freight index (truck-heavy)", group: "Freight", unit: "index", source: "FRED · BTS Freight TSI", note: "Free public stand-in for the proprietary ATA Truck Tonnage Index" },
  { key: "cass-shipments", id: "FRGSHPUSM649NCIS", label: "Cass shipments", group: "Freight", unit: "index (1990=100)", scale: 100, source: "FRED · Cass Information Systems", note: "Freight VOLUME across all modes (truck, rail, air, water)" },
  { key: "cass-expenditures", id: "FRGEXPUSM649NCIS", label: "Cass expenditures", group: "Freight", unit: "index (1990=100)", scale: 100, source: "FRED · Cass Information Systems", note: "Freight SPEND (volume × rate) — includes rate inflation" },
  { key: "inventories-sales", id: "ISRATIO", label: "Inventories-to-sales", group: "Freight", unit: "ratio", source: "FRED · Census", note: "Rising = inventory overhang (a freight/production headwind)" },
  // Consumer / demand (consumer sentiment lives on the Indicators tab — not duplicated here)
  { key: "retail-sales", id: "RSAFS", label: "Retail sales", group: "Consumer", unit: "$M SAAR", source: "FRED · Census" },
  { key: "durable-goods", id: "DGORDER", label: "Durable-goods orders", group: "Consumer", unit: "$M SAAR", source: "FRED · Census" },
  { key: "vehicle-sales", id: "TOTALSA", label: "Vehicle sales", group: "Consumer", unit: "M units SAAR", source: "FRED · BEA", note: "Total light-vehicle sales — big-ticket consumer demand" },
  // Labor — weekly, the timeliest read on the labor market turning (lower = healthier).
  { key: "initial-claims", id: "ICSA", label: "Initial jobless claims", group: "Labor", unit: "claims/wk", freq: "W", invert: true, source: "FRED · Dept. of Labor", note: "Weekly UI filings — LOWER = healthier; watch the trend" },
  { key: "continued-claims", id: "CCSA", label: "Continued claims", group: "Labor", unit: "claims", freq: "W", invert: true, source: "FRED · Dept. of Labor", note: "Still collecting UI — LOWER = healthier" },
  // Travel
  { key: "hotel-lodging-cpi", id: "CUSR0000SEHB", label: "Lodging-away CPI", group: "Travel", unit: "CPI index", source: "FRED · BLS", note: "Hotel PRICE proxy — NOT STR RevPAR (no occupancy/revenue)" },
  // Housing
  { key: "housing-starts", id: "HOUST", label: "Housing starts", group: "Housing", unit: "k units SAAR", source: "FRED · Census" },
  { key: "building-permits", id: "PERMIT", label: "Building permits", group: "Housing", unit: "k units SAAR", source: "FRED · Census" },
  { key: "construction-spend", id: "TTLCONS", label: "Construction spending", group: "Housing", unit: "$M SAAR", source: "FRED · Census" },
  { key: "new-home-sales", id: "HSN1F", label: "New home sales", group: "Housing", unit: "k units SAAR", source: "FRED · Census", note: "New single-family homes sold — the demand side" },
  { key: "mortgage-30yr", id: "MORTGAGE30US", label: "30-yr mortgage rate", group: "Housing", unit: "%", changeUnit: "pts", freq: "W", invert: true, source: "FRED · Freddie Mac", note: "LOWER = more supportive for housing demand" },
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
  const prevV = prevObs?.value ?? null, yearV = yearAgoObs?.value ?? null;
  // Diffusion-index surveys change in POINTS (a % move of a survey index is meaningless); everything
  // else in %. momPct/yoyPct carry whichever, tagged by changeUnit for the UI to render correctly.
  const chg = (base: number | null): number | null =>
    cfg.changeUnit === "pts" ? (base != null ? latestObs.value - base : null) : pct(latestObs.value, base);
  return {
    key: cfg.key, label: cfg.label, group: cfg.group, unit: cfg.unit, changeUnit: cfg.changeUnit, freq: cfg.freq, signLevel: cfg.signLevel, invert: cfg.invert, seriesId: cfg.id, source: cfg.source, note: cfg.note,
    latest: latestObs.value, latestDate: latestObs.date,
    prev: prevV, yearAgo: yearV,
    momPct: chg(prevV),
    yoyPct: chg(yearV),
    history: obs.slice(-252).map((o) => [o.date, o.value] as [string, number]),
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
    let obs = await fetchSeries(cfg.id, COSD).catch(() => []);
    if (cfg.scale && cfg.scale !== 1) obs = obs.map((o) => ({ date: o.date, value: Math.round(o.value * cfg.scale! * 100) / 100 })); // re-base (e.g. Cass 1990=1.0 → =100)
    const s = buildSeries(cfg, obs);
    if (s) { series.push(s); console.log(`  ${cfg.key.padEnd(22)} ${s.latest} @ ${s.latestDate}  (YoY ${s.yoyPct?.toFixed(1) ?? "—"}${s.changeUnit === "pts" ? "pts" : "%"})`); }
    else console.warn(`  ${cfg.key.padEnd(20)} no data (kept out of this run)`);
  }
  const tsa = await fetchTsa();
  console.log(tsa ? `  tsa                  ${tsa.latest} @ ${tsa.latestDate}  (7d-avg vs 1mo ${tsa.chg30dPct?.toFixed(1) ?? "—"}%)` : "  tsa                  unavailable (best-effort)");

  const data: RealEconomyData = { asOf: new Date().toISOString(), series, tsa };

  // AI desk read — regenerate ONLY when a monthly (FRED) series printed a new period, so the synthesis
  // stays stable rather than churning on daily TSA updates. Best-effort: no LLM / a bad call → no read
  // (the panel just omits the card). The read is grounded in the numbers above (lib/realEconomyRead).
  const vintage = (d: RealEconomyData) => d.series.map((s) => `${s.key}:${s.latestDate}`).sort().join("|");
  let prior: RealEconomyData | null = null;
  try { prior = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "real-economy.json"), "utf8")) as RealEconomyData; } catch { /* first run */ }
  if (prior?.read && vintage(prior) === vintage(data)) {
    data.read = prior.read;
    console.log("  desk read: monthly vintage unchanged — kept prior");
  } else if (await llmConfigured()) {
    data.read = await buildRealEconomyRead(data).catch(() => null);
    console.log(data.read ? `  desk read: regenerated (${data.read.regime}) — ${data.read.tldr.slice(0, 80)}…` : "  desk read: LLM returned nothing (skipped)");
  } else {
    console.log("  desk read: no LLM configured — skipped");
  }

  const w = await writeFeedGuarded("real-economy.json", data);
  console.log(`refresh-real-economy: ${w.reason}`);
  if (!w.written) { console.error("refresh-real-economy: kept prior file (this run was too thin) — will retry next tick."); process.exitCode = 1; }
}

main().catch((e) => { console.error("refresh-real-economy:", String((e as Error)?.message || e)); process.exitCode = 1; });
