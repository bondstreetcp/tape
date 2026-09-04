/**
 * "What's the technical setup into the print?" — a plain-English AI read of the chart going into earnings,
 * built from the daily close series the tab already has (no new fetch). Trend vs the 50/200-day averages,
 * where price sits in its 52-week range, momentum (RSI), the nearby support/resistance, and what that setup
 * implies for the reaction (priced near highs → vulnerable to a sell-the-news; washed out near lows → room
 * to squeeze). Served by ?part=techread. Decision-support, not advice.
 */
import { chatJSON, NO_ADVICE } from "./llm";
import { narrative, narrativeList } from "./llmValidate";

export interface TechnicalFacts {
  company: string;
  price: number | null;
  pctFrom52wHigh: number | null; // ≤0, how far below the 52-wk high
  pctFrom52wLow: number | null; // ≥0, how far above the 52-wk low
  pxVsMa50Pct: number | null;
  pxVsMa200Pct: number | null;
  goldenCross: boolean | null; // 50-day above 200-day
  ret1w: number | null;
  ret1m: number | null;
  ret3m: number | null;
  rsi14: number | null;
  hv20Pct: number | null; // annualized realized vol, %
  support: number | null; // nearest recent swing low
  resistance: number | null; // nearest recent swing high
  nearHigh: boolean;
  nearLow: boolean;
  sector: string | null; // GICS sector, for the RS line
  rsSector1mPct: number | null; // stock 1mo return − sector-ETF 1mo return (relative strength)
  rsSector3mPct: number | null; // stock 3mo return − sector-ETF 3mo return
  rsTrend: "leading" | "lagging" | "inline" | null;
}

export interface TechnicalRead {
  tldr: string;
  trend: "uptrend" | "downtrend" | "range";
  points: string[];
  support: number | null;
  resistance: number | null;
  caveat: string;
}

/** Compute the technical facts from a chronological daily close series (+ the sector ETF's closes for the
 *  relative-strength line). Null if too little history. */
export function computeTechnicalFacts(
  company: string,
  closes: { t: number; c: number }[],
  hv20Pct: number | null,
  sector: string | null = null,
  sectorCloses: number[] | null = null,
): TechnicalFacts | null {
  const c = (closes || []).filter((x) => x && Number.isFinite(x.c) && x.c > 0).map((x) => x.c);
  if (c.length < 60) return null;
  const price = c[c.length - 1];
  const tail = (n: number) => c.slice(-n);
  const mean = (a: number[]) => a.reduce((s, v) => s + v, 0) / a.length;
  const ma50 = c.length >= 50 ? mean(tail(50)) : null;
  const ma200 = c.length >= 200 ? mean(tail(200)) : null;
  const w52 = tail(252);
  const hi = Math.max(...w52), lo = Math.min(...w52);
  const retN = (n: number) => (c.length > n ? (price / c[c.length - 1 - n] - 1) * 100 : null);
  const r1w = retN(5), r1m = retN(21), r3m = retN(63);
  // Relative strength vs the sector ETF — stock return minus the ETF's return over the same window.
  const etf = (sectorCloses || []).filter((v) => Number.isFinite(v) && v > 0);
  const etfRet = (n: number) => (etf.length > n ? (etf[etf.length - 1] / etf[etf.length - 1 - n] - 1) * 100 : null);
  const e1m = etfRet(21), e3m = etfRet(63);
  const rsSector1mPct = r1m != null && e1m != null ? r1m - e1m : null;
  const rsSector3mPct = r3m != null && e3m != null ? r3m - e3m : null;
  const rsTrend: TechnicalFacts["rsTrend"] = rsSector3mPct == null ? null : rsSector3mPct > 2 ? "leading" : rsSector3mPct < -2 ? "lagging" : "inline";
  // RSI(14), simple-average variant — enough for a plain-English read.
  const rsi = (() => {
    const p = tail(15);
    if (p.length < 15) return null;
    let g = 0, l = 0;
    for (let i = 1; i < p.length; i++) { const d = p[i] - p[i - 1]; if (d >= 0) g += d; else l -= d; }
    if (l === 0) return 100;
    const rs = g / l;
    return 100 - 100 / (1 + rs);
  })();
  const recent = tail(63); // ~3 months for the nearby swing levels
  return {
    company,
    price,
    pctFrom52wHigh: hi > 0 ? (price / hi - 1) * 100 : null,
    pctFrom52wLow: lo > 0 ? (price / lo - 1) * 100 : null,
    pxVsMa50Pct: ma50 ? (price / ma50 - 1) * 100 : null,
    pxVsMa200Pct: ma200 ? (price / ma200 - 1) * 100 : null,
    goldenCross: ma50 != null && ma200 != null ? ma50 > ma200 : null,
    ret1w: r1w,
    ret1m: r1m,
    ret3m: r3m,
    rsi14: rsi,
    hv20Pct,
    support: Math.min(...recent),
    resistance: Math.max(...recent),
    nearHigh: hi > 0 && price / hi >= 0.97,
    nearLow: lo > 0 && price / lo <= 1.03,
    sector,
    rsSector1mPct,
    rsSector3mPct,
    rsTrend,
  };
}

const f1 = (v: number | null | undefined) => (v == null ? "?" : v.toFixed(1));
const sp = (v: number | null | undefined) => (v == null ? "?" : `${v >= 0 ? "+" : ""}${v.toFixed(1)}%`);

export async function buildTechnicalRead(f: TechnicalFacts): Promise<TechnicalRead | null> {
  if (f.price == null) return null;
  const sheet = [
    `Price $${f1(f.price)}. 52-week range: ${sp(f.pctFrom52wHigh)} from the high, ${sp(f.pctFrom52wLow)} above the low${f.nearHigh ? " (at/near the 52-wk HIGH)" : f.nearLow ? " (at/near the 52-wk LOW)" : ""}.`,
    f.pxVsMa50Pct != null && `Vs moving averages: ${sp(f.pxVsMa50Pct)} vs the 50-day${f.pxVsMa200Pct != null ? `, ${sp(f.pxVsMa200Pct)} vs the 200-day` : ""}${f.goldenCross != null ? `; 50-day is ${f.goldenCross ? "ABOVE" : "BELOW"} the 200-day (${f.goldenCross ? "golden-cross / uptrend" : "death-cross / downtrend"} regime)` : ""}.`,
    `Momentum: ${sp(f.ret1w)} 1wk, ${sp(f.ret1m)} 1mo, ${sp(f.ret3m)} 3mo${f.rsi14 != null ? `; RSI(14) ${f.rsi14.toFixed(0)}${f.rsi14 >= 70 ? " (overbought)" : f.rsi14 <= 30 ? " (oversold)" : ""}` : ""}.`,
    f.support != null && f.resistance != null && `Recent (~3mo) range: support ~$${f1(f.support)}, resistance ~$${f1(f.resistance)}.`,
    f.rsSector3mPct != null && `Relative strength vs its sector${f.sector ? ` (${f.sector})` : ""}: ${sp(f.rsSector3mPct)} over 3mo${f.rsSector1mPct != null ? `, ${sp(f.rsSector1mPct)} over 1mo` : ""} — ${f.rsTrend === "leading" ? "LEADING the sector" : f.rsTrend === "lagging" ? "LAGGING the sector" : "roughly in line with the sector"}.`,
    f.hv20Pct != null && `Realized vol (HV20): ${f.hv20Pct.toFixed(0)}% annualized.`,
  ].filter(Boolean).join("\n");

  const SYSTEM =
    "You are a technical analyst explaining a stock's chart setup going INTO its earnings print, in PLAIN ENGLISH, to a smart generalist. " +
    "Using ONLY the technical facts provided — never invent a level or a number — describe: the trend (vs the 50/200-day averages), where price sits in its 52-week range, momentum (recent returns + RSI), its relative strength vs its sector (leading = a tailwind into the print, lagging = a headwind), the nearby support/resistance, and what the setup implies for the print (e.g., pinned near the highs = priced for good news, vulnerable to a sell-the-news; washed out near the lows / oversold = room to squeeze on anything not-terrible; coiled mid-range = a breakout either way). " +
    "Be concrete and balanced; if signals conflict, say so. Technicals describe positioning, NOT a forecast — and never tell the reader what to trade. " +
    NO_ADVICE;
  const SCHEMA =
    'Return ONLY JSON: {"tldr":string (ONE sentence — the setup in a line),' +
    '"trend":"uptrend"|"downtrend"|"range",' +
    '"points":string[] (2-4 short plain-English sentences — trend/averages, range position, momentum, and the level that matters into the print),' +
    '"support":number|null (the key level to hold, from the facts),"resistance":number|null (the key level to clear),' +
    '"caveat":string (ONE sentence: technicals are positioning, not a forecast)}';

  const out = await chatJSON<{ tldr?: string; trend?: string; points?: unknown; support?: unknown; resistance?: unknown; caveat?: string }>(
    SYSTEM,
    `Company: ${f.company}\n\nTECHNICAL FACTS (into the earnings print):\n${sheet}\n\n${SCHEMA}`,
    { maxTokens: 700, reasoningEffort: "low" },
  );
  // narrative(): a "…" shell in the tldr or the points is no read at all (lib/llmValidate)
  const tldr = narrative(out?.tldr, 320);
  if (!out || !tldr || !Array.isArray(out.points)) return null;
  const trend = ["uptrend", "downtrend", "range"].includes(String(out.trend)) ? (out.trend as TechnicalRead["trend"]) : "range";
  const points = narrativeList(out.points, 4, 280);
  if (!points.length) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    tldr,
    trend,
    points,
    support: num(out.support),
    resistance: num(out.resistance),
    caveat: narrative(out.caveat, 240) || "Technicals describe positioning into the print, not a forecast of the result.",
  };
}
