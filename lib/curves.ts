import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);

// Each curve point (a VIX tenor or an oil contract month) carries the level now and
// where it sat 1 week / 1 month / 1 year ago, so the chart can overlay the curve's
// recent history.
export interface CurvePt { label: string; now?: number; w1?: number; m1?: number; y1?: number }
export interface VolOil { vix: CurvePt[]; oil: CurvePt[]; asOf: string }

// CBOE S&P 500 volatility term structure (9-day → 1-year).
const VIX: [string, string][] = [
  ["^VIX9D", "9-day"], ["^VIX", "1-mo"], ["^VIX3M", "3-mo"], ["^VIX6M", "6-mo"], ["^VIX1Y", "1-yr"],
];
const MONTH_CODE = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"]; // Jan..Dec NYMEX codes
const DAY = 86400000;

/** ~13 months of daily closes for a symbol, as [epochMs, close] sorted ascending. */
async function history(sym: string): Promise<[number, number][]> {
  try {
    const r: any = await yf.chart(sym, { period1: new Date(Date.now() - 400 * DAY), interval: "1d" }, { validateResult: false });
    const out: [number, number][] = [];
    for (const q of r?.quotes ?? []) {
      const t = q?.date ? new Date(q.date).getTime() : null;
      const c = typeof q?.close === "number" ? q.close : null;
      if (t != null && c != null) out.push([t, c]);
    }
    return out;
  } catch {
    return [];
  }
}

/** Latest close at or before a target time (history is ascending). */
function onOrBefore(h: [number, number][], t: number): number | undefined {
  let v: number | undefined;
  for (const [ts, c] of h) {
    if (ts <= t) v = c;
    else break;
  }
  return v;
}

function pointFrom(label: string, h: [number, number][]): CurvePt {
  if (!h.length) return { label };
  const last = h[h.length - 1][0];
  return {
    label,
    now: h[h.length - 1][1],
    w1: onOrBefore(h, last - 7 * DAY),
    m1: onOrBefore(h, last - 30 * DAY),
    y1: onOrBefore(h, last - 365 * DAY),
  };
}

/** VIX term structure + WTI crude futures curve, live from Yahoo (reachable from
 *  Vercel, unlike FRED), each point carrying its level now and 1wk/1mo/1yr ago.
 *  Oil contract symbols are generated for the next ~10 months (CL{code}{YY}.NYM);
 *  only those that return data are kept. */
export async function getVolOilCurves(): Promise<VolOil> {
  const now = new Date();
  let y = now.getUTCFullYear();
  let m = now.getUTCMonth() + 1; // start at next month (front contract)
  if (m > 11) { m = 0; y++; }
  const oilSyms: { sym: string; label: string }[] = [];
  for (let i = 0; i < 10; i++) {
    oilSyms.push({
      sym: `CL${MONTH_CODE[m]}${String(y).slice(2)}.NYM`,
      label: new Date(Date.UTC(y, m, 1)).toLocaleDateString("en-US", { month: "short", year: "2-digit" }),
    });
    m++; if (m > 11) { m = 0; y++; }
  }

  const [vixH, oilH] = await Promise.all([
    Promise.all(VIX.map(([s]) => history(s))),
    Promise.all(oilSyms.map((o) => history(o.sym))),
  ]);

  const vix = VIX.map(([, label], i) => pointFrom(label, vixH[i])).filter((p) => p.now != null);
  const oil = oilSyms.map((o, i) => pointFrom(o.label, oilH[i])).filter((p) => p.now != null);
  return { vix, oil, asOf: now.toISOString() };
}
