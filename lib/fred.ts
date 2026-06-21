/**
 * Macro indicators from FRED (St. Louis Fed) via the public fredgraph CSV
 * endpoint — no API key required. Fetched per-series (mixed frequencies would
 * otherwise come back zipped) and cached by the page's ISR window.
 */
import { RELEASES, type ReleaseData } from "./releases";

const FREDGRAPH = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const DAY = 86_400_000;

interface Obs { date: string; value: number }

async function fetchSeries(id: string, cosd: string): Promise<Obs[]> {
  // Read the key at call time so a script can load .env.local before invoking getMacro.
  const apiKey = process.env.FRED_API_KEY;
  try {
    if (apiKey) {
      // Keyed data API returns FULL history; the keyless graph CSV caps at ~800 obs (~3yr).
      const url = `https://api.stlouisfed.org/fred/series/observations?series_id=${id}&api_key=${apiKey}&file_type=json&observation_start=${cosd}`;
      const res = await fetch(url, { headers: { "User-Agent": "stock-chart-screener (research)" } });
      if (res.ok) {
        const j: any = await res.json();
        const out: Obs[] = [];
        for (const o of j?.observations ?? []) {
          const v = parseFloat(o?.value);
          if (o?.date && Number.isFinite(v)) out.push({ date: o.date, value: v });
        }
        if (out.length) return out;
      }
      // else fall through to the keyless CSV endpoint
    }
    const res = await fetch(`${FREDGRAPH}?id=${id}&cosd=${cosd}`, {
      headers: { "User-Agent": "stock-chart-screener (research)" },
    });
    if (!res.ok) return [];
    const lines = (await res.text()).trim().split(/\r?\n/).slice(1);
    const out: Obs[] = [];
    for (const ln of lines) {
      const c = ln.split(",");
      const v = parseFloat(c[1]);
      if (c[0] && Number.isFinite(v)) out.push({ date: c[0], value: v });
    }
    return out;
  } catch {
    return [];
  }
}

const last = (o: Obs[]) => (o.length ? o[o.length - 1] : null);
function onOrBefore(o: Obs[], targetMs: number): Obs | null {
  let r: Obs | null = null;
  for (const x of o) {
    if (new Date(x.date).getTime() <= targetMs) r = x;
    else break;
  }
  return r;
}

const CURVE: [string, string, number][] = [
  ["DGS1MO", "1M", 1 / 12],
  ["DGS3MO", "3M", 0.25],
  ["DGS6MO", "6M", 0.5],
  ["DGS1", "1Y", 1],
  ["DGS2", "2Y", 2],
  ["DGS3", "3Y", 3],
  ["DGS5", "5Y", 5],
  ["DGS7", "7Y", 7],
  ["DGS10", "10Y", 10],
  ["DGS20", "20Y", 20],
  ["DGS30", "30Y", 30],
];

export interface CurvePoint { label: string; mat: number; now: number | null; monthAgo: number | null; yearAgo: number | null }
export interface MacroInd { key: string; label: string; value: number | null; unit: string; asOf: string | null; group: string; seriesId?: string; history?: [string, number][] }
export interface Macro { curve: CurvePoint[]; indicators: MacroInd[]; asOf: string; gdpNow?: { value: number; asOf: string } | null; releases?: Record<string, ReleaseData>; creditSeries?: { hy: [string, number][]; ig: [string, number][]; baa?: [string, number][] } }

export async function getMacro(): Promise<Macro> {
  const now = Date.now();
  const curveStart = new Date(now - 400 * DAY).toISOString().slice(0, 10);

  const curveSeries = await Promise.all(
    CURVE.map(async ([id, label, mat]) => ({ id, label, mat, obs: await fetchSeries(id, curveStart) })),
  );
  const curve: CurvePoint[] = curveSeries.map(({ label, mat, obs }) => ({
    label,
    mat,
    now: last(obs)?.value ?? null,
    monthAgo: onOrBefore(obs, now - 30 * DAY)?.value ?? null,
    yearAgo: onOrBefore(obs, now - 365 * DAY)?.value ?? null,
  }));

  const FIVEY = 5 * 365 * DAY;
  const downsample = (pairs: [string, number][], n = 90): [string, number][] => {
    if (pairs.length <= n) return pairs;
    const step = Math.ceil(pairs.length / n);
    const out: [string, number][] = [];
    for (let i = 0; i < pairs.length; i += step) out.push(pairs[i]);
    if (out[out.length - 1]?.[0] !== pairs[pairs.length - 1][0]) out.push(pairs[pairs.length - 1]);
    return out;
  };
  type Ind = { v: number | null; asOf: string | null; history: [string, number][] };
  const yoy = async (id: string): Promise<Ind> => {
    const o = await fetchSeries(id, new Date(now - FIVEY - 400 * DAY).toISOString().slice(0, 10));
    const l = last(o);
    if (!l) return { v: null, asOf: null, history: [] };
    const prior = onOrBefore(o, new Date(l.date).getTime() - 360 * DAY);
    const yoyPairs: [string, number][] = [];
    for (const x of o) {
      const p = onOrBefore(o, new Date(x.date).getTime() - 360 * DAY);
      if (p && p.value) yoyPairs.push([x.date, (x.value / p.value - 1) * 100]);
    }
    return { v: prior ? (l.value / prior.value - 1) * 100 : null, asOf: l.date, history: downsample(yoyPairs) };
  };
  const simple = async (id: string): Promise<Ind> => {
    const o = await fetchSeries(id, new Date(now - FIVEY).toISOString().slice(0, 10));
    const l = last(o);
    return { v: l?.value ?? null, asOf: l?.date ?? null, history: downsample(o.map((x) => [x.date, x.value] as [string, number])) };
  };

  const [cpi, core, ff, unrate, t102, hy, ig, gdp] = await Promise.all([
    yoy("CPIAUCSL"),
    yoy("CPILFESL"),
    simple("FEDFUNDS"),
    simple("UNRATE"),
    simple("T10Y2Y"),
    simple("BAMLH0A0HYM2"),
    simple("BAMLC0A0CM"),
    simple("A191RL1Q225SBEA"),
  ]);

  const indicators: MacroInd[] = [
    { key: "ff", label: "Fed Funds Rate", value: ff.v, unit: "%", asOf: ff.asOf, group: "Rates", seriesId: "FEDFUNDS", history: ff.history },
    { key: "t102", label: "10Y–2Y Spread", value: t102.v, unit: "pp", asOf: t102.asOf, group: "Rates", seriesId: "T10Y2Y", history: t102.history },
    { key: "cpi", label: "CPI (YoY)", value: cpi.v, unit: "%", asOf: cpi.asOf, group: "Inflation", seriesId: "CPIAUCSL", history: cpi.history },
    { key: "core", label: "Core CPI (YoY)", value: core.v, unit: "%", asOf: core.asOf, group: "Inflation", seriesId: "CPILFESL", history: core.history },
    { key: "unrate", label: "Unemployment", value: unrate.v, unit: "%", asOf: unrate.asOf, group: "Growth & Jobs", seriesId: "UNRATE", history: unrate.history },
    { key: "gdp", label: "Real GDP (annualized QoQ)", value: gdp.v, unit: "%", asOf: gdp.asOf, group: "Growth & Jobs", seriesId: "A191RL1Q225SBEA", history: gdp.history },
    { key: "hy", label: "High-Yield OAS", value: hy.v, unit: "%", asOf: hy.asOf, group: "Credit", seriesId: "BAMLH0A0HYM2", history: hy.history },
    { key: "ig", label: "Inv-Grade OAS", value: ig.v, unit: "%", asOf: ig.asOf, group: "Credit", seriesId: "BAMLC0A0CM", history: ig.history },
  ];

  // Daily credit-spread series for the rates page's windowed charts (the indicator
  // `history` is downsampled to ~90 pts, too coarse for a 1-month view).
  //  • ICE BofA IG/HY OAS — the standard option-adjusted spreads, but FRED's ICE
  //    license only carries a rolling ~3yr, so these top out there even with a key.
  //  • Moody's Baa–10Y Treasury spread (BAA10Y) — a classic credit gauge with decades
  //    of history (needs FRED_API_KEY for the full daily series), for the long cycle.
  const creditStart = new Date(now - 6 * 365 * DAY).toISOString().slice(0, 10);
  const baaStart = new Date(now - 12 * 365 * DAY).toISOString().slice(0, 10);
  const [hyObs, igObs, baaObs] = await Promise.all([
    fetchSeries("BAMLH0A0HYM2", creditStart),
    fetchSeries("BAMLC0A0CM", creditStart),
    fetchSeries("BAA10Y", baaStart),
  ]);
  const creditSeries = {
    hy: hyObs.map((o) => [o.date, o.value] as [string, number]),
    ig: igObs.map((o) => [o.date, o.value] as [string, number]),
    baa: baaObs.map((o) => [o.date, o.value] as [string, number]),
  };

  // Atlanta Fed GDPNow — a running estimate of the current quarter's real GDP
  // growth, i.e. the market's working number ahead of the next GDP release.
  let gdpNow: { value: number; asOf: string } | null = null;
  try {
    const gn = await fetchSeries("GDPNOW", new Date(now - 200 * DAY).toISOString().slice(0, 10));
    const l = last(gn);
    if (l) gdpNow = { value: l.value, asOf: l.date };
  } catch {
    /* leave null */
  }

  // Recent prints for each calendar release, so an expanded row shows its history.
  const FOURY = 4 * 365 * DAY;
  const buildRelease = async (def: (typeof RELEASES)[number]): Promise<ReleaseData | null> => {
    try {
      const obs = await fetchSeries(def.fredId, new Date(now - FOURY).toISOString().slice(0, 10));
      if (!obs.length) return null;
      let pairs: [string, number][] = [];
      if (def.transform === "yoy") {
        for (const x of obs) {
          const p = onOrBefore(obs, new Date(x.date).getTime() - 360 * DAY);
          if (p && p.value) pairs.push([x.date, (x.value / p.value - 1) * 100]);
        }
      } else if (def.transform === "mom") {
        for (let i = 1; i < obs.length; i++) if (obs[i - 1].value) pairs.push([obs[i].date, (obs[i].value / obs[i - 1].value - 1) * 100]);
      } else if (def.transform === "momChange") {
        for (let i = 1; i < obs.length; i++) pairs.push([obs[i].date, (obs[i].value - obs[i - 1].value) * def.scale]);
      } else {
        for (const x of obs) pairs.push([x.date, x.value * def.scale]);
      }
      pairs = pairs.slice(def.chart === "bar" ? -16 : -24);
      if (!pairs.length) return null;
      const lt = pairs[pairs.length - 1];
      const pr = pairs[pairs.length - 2];
      return { key: def.key, label: def.label, unit: def.unit, chart: def.chart, hint: def.hint, history: pairs, latest: lt[1], latestDate: lt[0], prior: pr ? pr[1] : null, nowcast: null };
    } catch {
      return null;
    }
  };
  const releaseList = await Promise.all(RELEASES.map(buildRelease));
  const releases: Record<string, ReleaseData> = {};
  for (const r of releaseList) if (r) releases[r.key] = r;
  if (releases.gdp && gdpNow) releases.gdp.nowcast = gdpNow.value;

  return { curve, indicators, asOf: new Date(now).toISOString(), gdpNow, releases, creditSeries };
}
