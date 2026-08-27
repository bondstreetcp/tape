/**
 * refresh-energy — the Energy tab's feed. Two halves:
 *   • Prices (keyless) — WTI, Brent, Henry Hub, US retail gasoline & diesel, from FRED's keyless CSV.
 *   • The EIA weekly balance (needs a free EIA_API_KEY, https://www.eia.gov/opendata/register.php) —
 *     crude/gasoline/distillate inventories + lower-48 natural-gas storage (with the weekly build/draw
 *     and level vs its ~5-yr seasonal norm), and supply & demand (US crude production, refinery
 *     utilization, and product supplied = implied demand), from the EIA v2 API.
 *
 * The prices ALWAYS write, so the tab is useful with no key; the EIA half fills in once the key is set
 * (on the NAS + as a GitHub Actions secret). Writes data/energy.json. Weekly cadence (EIA publishes
 * Wed/Thu), refreshed on FULL.
 *
 *   EIA_API_KEY=... npx tsx scripts/refresh-energy.ts
 */
import { fetchSeries, type Obs } from "../lib/fred";
import { writeFeedGuarded } from "../lib/feedGuard";
import type { EnergyData, EnergySeries, EnergyGroup } from "../lib/energy";

const KEY = process.env.EIA_API_KEY || "";
const EIA = "https://api.eia.gov/v2";
const UA = { "User-Agent": "stock-chart-screener (research)" };
const COSD = "2005-01-01";

// ── helpers ──────────────────────────────────────────────────────────────────
const DAY = 86_400_000;
const t = (d: string) => new Date(d + "T00:00:00Z").getTime();

/** Value at (or the closest observation at-or-before) latestDate − daysBack. */
function valueBack(obs: Obs[], daysBack: number): number | null {
  if (!obs.length) return null;
  const target = t(obs[obs.length - 1].date) - daysBack * DAY;
  let best: Obs | null = null;
  for (const o of obs) { if (t(o.date) <= target) best = o; else break; }
  return best ? best.value : null;
}

const pctChg = (cur: number | null, base: number | null): number | null =>
  cur == null || base == null || base === 0 ? null : ((cur - base) / Math.abs(base)) * 100;

/** Downsample to ~weekly for a compact sparkline; keep the last `keep` points. */
function weekly(obs: Obs[], keep = 260): [string, number][] {
  const out: [string, number][] = [];
  let last = -Infinity;
  for (const o of obs) {
    if (t(o.date) - last >= 6.5 * DAY) { out.push([o.date, o.value]); last = t(o.date); }
  }
  if (obs.length && out[out.length - 1]?.[0] !== obs[obs.length - 1].date) {
    const l = obs[obs.length - 1]; out.push([l.date, l.value]);
  }
  return out.slice(-keep);
}

/** Level vs the ~5-yr seasonal norm for this time of year: mean of prior-year obs within ±5 days of
 *  the latest point's month/day, then the % difference. null if too few comparisons. */
function vsSeasonal(obs: Obs[]): number | null {
  if (obs.length < 60) return null;
  const latest = obs[obs.length - 1];
  const ld = new Date(latest.date + "T00:00:00Z");
  const mo = ld.getUTCMonth(), da = ld.getUTCDate(), yr = ld.getUTCFullYear();
  const peers: number[] = [];
  for (const o of obs) {
    const d = new Date(o.date + "T00:00:00Z");
    if (d.getUTCFullYear() >= yr) continue; // prior years only
    if (d.getUTCFullYear() < yr - 5) continue; // last ~5 years
    // days between this date's month/day and the latest's month/day, within the same year frame
    const anchor = Date.UTC(d.getUTCFullYear(), mo, da);
    if (Math.abs(d.getTime() - anchor) <= 5 * DAY) peers.push(o.value);
  }
  if (peers.length < 3) return null;
  const avg = peers.reduce((a, b) => a + b, 0) / peers.length;
  return pctChg(latest.value, avg);
}

// ── keyless prices (FRED) ──────────────────────────────────────────────────────
type PriceCfg = { key: string; label: string; id: string; unit: string; signMode?: "goodUp" | "goodDown" };
const PRICES: PriceCfg[] = [
  { key: "wti", label: "WTI crude", id: "DCOILWTICO", unit: "$/bbl" },
  { key: "brent", label: "Brent crude", id: "DCOILBRENTEU", unit: "$/bbl" },
  { key: "henryhub", label: "Nat gas · Henry Hub", id: "DHHNGSP", unit: "$/MMBtu" },
  { key: "gasoline", label: "Retail gasoline", id: "GASREGW", unit: "$/gal", signMode: "goodDown" },
  { key: "diesel", label: "Retail diesel", id: "GASDESW", unit: "$/gal", signMode: "goodDown" },
];

async function buildPrice(c: PriceCfg): Promise<EnergySeries | null> {
  const obs = await fetchSeries(c.id, COSD);
  if (obs.length < 10) return null;
  const latest = obs[obs.length - 1];
  return {
    key: c.key, label: c.label, group: "Prices", unit: c.unit, source: "FRED", signMode: c.signMode,
    latest: latest.value, latestDate: latest.date,
    wow: null, wowPct: pctChg(latest.value, valueBack(obs, 7)), yoyPct: pctChg(latest.value, valueBack(obs, 365)),
    vsSeasonalPct: null, history: weekly(obs),
  };
}

// ── keyed EIA weekly balance ───────────────────────────────────────────────────
type EiaCfg = {
  key: string; label: string; group: EnergyGroup; route: string; series: string;
  unit: string; scale?: number; seasonal?: boolean; signMode?: "goodUp" | "goodDown";
};
const EIA_SERIES: EiaCfg[] = [
  // Inventories (thousand bbl → M bbl); natgas storage in Bcf. Build/draw + vs-seasonal are the reads.
  { key: "crudeStocks", label: "Crude oil (ex-SPR)", group: "Inventories", route: "petroleum/stoc/wstk", series: "WCESTUS1", unit: "M bbl", scale: 1 / 1000, seasonal: true },
  { key: "gasStocks", label: "Gasoline", group: "Inventories", route: "petroleum/stoc/wstk", series: "WGTSTUS1", unit: "M bbl", scale: 1 / 1000, seasonal: true },
  { key: "distStocks", label: "Distillate (diesel/heat)", group: "Inventories", route: "petroleum/stoc/wstk", series: "WDISTUS1", unit: "M bbl", scale: 1 / 1000, seasonal: true },
  { key: "ngStorage", label: "Nat gas storage (L48)", group: "Inventories", route: "natural-gas/stor/wkly", series: "NW2_EPG0_SWO_R48_BCF", unit: "Bcf", seasonal: true },
  // Supply & demand (thousand bbl/d → M bbl/d); refinery utilization %.
  { key: "crudeProd", label: "US crude production", group: "Supply & demand", route: "petroleum/sum/sndw", series: "WCRFPUS2", unit: "M bbl/d", scale: 1 / 1000 },
  { key: "refUtil", label: "Refinery utilization", group: "Supply & demand", route: "petroleum/sum/sndw", series: "WPULEUS3", unit: "%", signMode: "goodUp" },
  { key: "prodSupplied", label: "Products supplied (demand)", group: "Supply & demand", route: "petroleum/sum/sndw", series: "WRPUPUS2", unit: "M bbl/d", scale: 1 / 1000, signMode: "goodUp" },
  { key: "gasSupplied", label: "Gasoline supplied", group: "Supply & demand", route: "petroleum/sum/sndw", series: "WGFUPUS2", unit: "M bbl/d", scale: 1 / 1000, signMode: "goodUp" },
  { key: "distSupplied", label: "Distillate supplied", group: "Supply & demand", route: "petroleum/sum/sndw", series: "WDIUPUS2", unit: "M bbl/d", scale: 1 / 1000, signMode: "goodUp" },
];

async function eiaFetch(route: string, series: string): Promise<Obs[]> {
  const url = `${EIA}/${route}/data/?api_key=${KEY}&frequency=weekly&data[0]=value` +
    `&facets[series][]=${encodeURIComponent(series)}&sort[0][column]=period&sort[0][direction]=desc&length=600`;
  const res = await fetch(url, { headers: UA, signal: AbortSignal.timeout(25_000) });
  if (!res.ok) {
    // Surface EIA's own error (e.g. API_KEY_INVALID) instead of a bare status — the difference between
    // "the key is bad" and "the route is wrong" is exactly this message.
    let detail = "";
    try { const b = await res.text(); const j = JSON.parse(b); detail = j?.error?.code || j?.error?.message || b.slice(0, 80); } catch { /* non-JSON body */ }
    throw new Error(`HTTP ${res.status}${detail ? ` · ${String(detail).slice(0, 90)}` : ""}`);
  }
  const j: any = await res.json();
  const rows: any[] = j?.response?.data ?? [];
  return rows
    .map((r) => ({ date: String(r.period).slice(0, 10), value: parseFloat(r.value) }))
    .filter((o) => o.date && Number.isFinite(o.value))
    .sort((a, b) => t(a.date) - t(b.date));
}

async function buildEia(c: EiaCfg): Promise<EnergySeries | null> {
  const raw = await eiaFetch(c.route, c.series);
  if (raw.length < 10) return null;
  const sc = c.scale ?? 1;
  const obs: Obs[] = raw.map((o) => ({ date: o.date, value: Math.round(o.value * sc * 100) / 100 }));
  const latest = obs[obs.length - 1];
  const prior = obs[obs.length - 2] ?? latest;
  return {
    key: c.key, label: c.label, group: c.group, unit: c.unit, source: "EIA", signMode: c.signMode,
    latest: latest.value, latestDate: latest.date,
    wow: Math.round((latest.value - prior.value) * 100) / 100,
    wowPct: pctChg(latest.value, prior.value),
    yoyPct: pctChg(latest.value, valueBack(obs, 365)),
    vsSeasonalPct: c.seasonal ? vsSeasonal(obs) : null,
    history: weekly(obs),
  };
}

// ── main ────────────────────────────────────────────────────────────────────
async function main() {
  const series: EnergySeries[] = [];

  for (const c of PRICES) {
    try {
      const s = await buildPrice(c);
      if (s) { series.push(s); console.log(`  price ${c.key.padEnd(9)} ${s.latest} ${c.unit} @ ${s.latestDate} (wow ${s.wowPct?.toFixed(1)}%)`); }
      else console.warn(`  price ${c.key}: insufficient FRED data`);
    } catch (e: any) { console.warn(`  price ${c.key}: ${String(e?.message || e).slice(0, 50)}`); }
  }

  if (KEY) {
    let lastErr = "";
    for (const c of EIA_SERIES) {
      try {
        const s = await buildEia(c);
        if (s) { series.push(s); console.log(`  eia   ${c.key.padEnd(12)} ${s.latest} ${c.unit} @ ${s.latestDate} (wow ${s.wow}${s.vsSeasonalPct != null ? `, vs5yr ${s.vsSeasonalPct.toFixed(1)}%` : ""})`); }
        else console.warn(`  eia   ${c.key}: no data — check route/series (${c.route} · ${c.series})`);
      } catch (e: any) { lastErr = String(e?.message || e); console.warn(`  eia   ${c.key}: ${lastErr.slice(0, 90)}`); }
    }
    // A uniform key rejection means the routes are fine and the key is the problem — say so plainly.
    if (!series.some((s) => s.source === "EIA") && /API_KEY_INVALID|API_KEY_MISSING|403/.test(lastErr)) {
      console.warn("  → EIA rejected the API key (the routes/series are correct). Confirm the key is ACTIVATED (check the registration email for a confirmation link) and copied EXACTLY (no dropped character or trailing space), then retry. New keys can take a few minutes to go live.");
    }
  } else {
    console.warn("  EIA_API_KEY not set — wrote prices only. Add a free key (https://www.eia.gov/opendata/register.php) on the NAS + as a GH secret to fill in the weekly balance.");
  }

  const data: EnergyData = { asOf: new Date().toISOString(), eiaConfigured: !!KEY, series };
  const w = await writeFeedGuarded("energy.json", data);
  console.log(`refresh-energy: ${series.length} series (${series.filter((s) => s.source === "EIA").length} EIA) — ${w.reason}`);
  if (!w.written) { console.error("refresh-energy: kept prior file (too thin) — retry next tick."); process.exitCode = 1; }
}

main().catch((e) => { console.error("refresh-energy:", String((e as Error)?.message || e)); process.exitCode = 1; });
