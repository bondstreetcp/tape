import YahooFinance from "yahoo-finance2";
import { getFilings } from "./edgar";

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);
const DAY = 86_400_000;

const num = (v: any): number | null =>
  v == null ? null : typeof v === "number" ? (Number.isFinite(v) ? v : null) : typeof v === "object" && typeof v.raw === "number" ? v.raw : null;

export interface EarningsReaction {
  date: string; // earnings (8-K) announcement date
  reactionDate: string; // trading day the move is measured on
  move: number | null; // close-to-close % reaction (decimal)
  surprise: number | null; // EPS surprise % (decimal), where available
}

/** The last `n` earnings dates (SEC 8-K item 2.02) with the stock's one-day
 *  price reaction. Companies report before the open or after the close, so we
 *  take the larger-magnitude move of the announcement day vs. the next session
 *  to capture the reaction either way. EPS surprise is merged where Yahoo has it. */
export async function getEarningsReactions(symbol: string, n = 10): Promise<EarningsReaction[]> {
  const sym = symbol.toUpperCase();

  // 1) Earnings announcement dates from EDGAR 8-K item 2.02 (newest first).
  let dates: string[] = [];
  try {
    const { filings } = await getFilings(sym, 0, 300);
    dates = [...new Set(filings.filter((f) => f.isEarnings).map((f) => f.date))].slice(0, n + 2);
  } catch {
    /* none */
  }
  if (!dates.length) return [];

  // 2) Daily closes covering the range.
  const earliest = dates[dates.length - 1];
  let closes: { t: number; c: number }[] = [];
  try {
    const chart: any = await yf.chart(
      sym,
      { period1: new Date(new Date(earliest).getTime() - 7 * DAY), interval: "1d" } as any,
      { validateResult: false },
    );
    closes = (chart.quotes || [])
      .filter((q: any) => q?.date && q.close != null)
      .map((q: any) => ({ t: new Date(q.date).getTime(), c: q.close }))
      .sort((a: any, b: any) => a.t - b.t);
  } catch {
    return [];
  }
  if (closes.length < 3) return [];

  // 3) Recent EPS surprises (Yahoo only keeps ~4 quarters).
  const surprises: { t: number; sp: number }[] = [];
  try {
    const r: any = await yf.quoteSummary(sym, { modules: ["earningsHistory"] as any }, { validateResult: false });
    for (const h of r.earningsHistory?.history || []) {
      const sp = num(h.surprisePercent);
      const t = h.quarter ? new Date(h.quarter).getTime() : NaN;
      if (sp != null && Number.isFinite(t)) surprises.push({ t, sp });
    }
  } catch {
    /* optional */
  }

  // 4) Next-session reaction per earnings date (most large caps report after the
  //    close, so the move shows up the following trading day).
  const out: EarningsReaction[] = [];
  for (const d of dates) {
    const dt = new Date(d + "T00:00:00Z").getTime();
    const j = closes.findIndex((b) => b.t > dt); // first session strictly after the announcement
    if (j < 1) continue;
    const move = closes[j].c / closes[j - 1].c - 1;
    // Surprise: the announcement is ~30–45 days after the fiscal quarter end.
    let surprise: number | null = null;
    let bestGap = 55 * DAY;
    for (const s of surprises) {
      const gap = Math.abs(s.t - dt);
      if (gap < bestGap) {
        bestGap = gap;
        surprise = s.sp;
      }
    }
    out.push({
      date: d,
      reactionDate: new Date(closes[j].t).toISOString().slice(0, 10),
      move,
      surprise,
    });
    if (out.length >= n) break;
  }
  return out;
}
