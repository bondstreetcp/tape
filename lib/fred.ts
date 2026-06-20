/**
 * Macro indicators from FRED (St. Louis Fed) via the public fredgraph CSV
 * endpoint — no API key required. Fetched per-series (mixed frequencies would
 * otherwise come back zipped) and cached by the page's ISR window.
 */
const FREDGRAPH = "https://fred.stlouisfed.org/graph/fredgraph.csv";
const DAY = 86_400_000;

interface Obs { date: string; value: number }

async function fetchSeries(id: string, cosd: string): Promise<Obs[]> {
  try {
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
export interface Macro { curve: CurvePoint[]; indicators: MacroInd[]; asOf: string }

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

  return { curve, indicators, asOf: new Date(now).toISOString() };
}
