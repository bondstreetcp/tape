import YahooFinance from "yahoo-finance2";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);

export interface CurvePt { label: string; value: number }
export interface VolOil { vix: CurvePt[]; oil: CurvePt[]; asOf: string }

// CBOE S&P 500 volatility term structure (9-day → 1-year).
const VIX: [string, string][] = [
  ["^VIX9D", "9-day"], ["^VIX", "1-mo"], ["^VIX3M", "3-mo"], ["^VIX6M", "6-mo"], ["^VIX1Y", "1-yr"],
];
const MONTH_CODE = ["F", "G", "H", "J", "K", "M", "N", "Q", "U", "V", "X", "Z"]; // Jan..Dec NYMEX codes

/** VIX term structure + WTI crude futures curve, live from Yahoo (reachable from
 *  Vercel, unlike FRED). Oil contract symbols are generated for the next ~10
 *  months (CL{monthCode}{YY}.NYM); only those that return a price are kept. */
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

  const all = [...VIX.map((v) => v[0]), ...oilSyms.map((o) => o.sym)];
  const px = new Map<string, number>();
  try {
    const qs = (await yf.quote(all, {}, { validateResult: false })) as any[];
    for (const q of qs) if (q?.symbol && typeof q.regularMarketPrice === "number") px.set(q.symbol, q.regularMarketPrice);
  } catch {
    /* leave empty */
  }

  const vix = VIX.map(([s, label]) => ({ label, value: px.get(s) })).filter((p): p is CurvePt => p.value != null);
  const oil = oilSyms.map((o) => ({ label: o.label, value: px.get(o.sym) })).filter((p): p is CurvePt => p.value != null);
  return { vix, oil, asOf: new Date().toISOString() };
}
