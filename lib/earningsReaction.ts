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
  drift3: number | null; // return from the reaction close → +3 sessions (post-earnings drift)
  drift5: number | null; // return from the reaction close → +5 sessions
}

/** The last `n` earnings dates (SEC 8-K item 2.02) with the stock's one-day
 *  price reaction. Companies report before the open or after the close, so we
 *  take the larger-magnitude move of the announcement day vs. the next session
 *  to capture the reaction either way. EPS surprise is merged where Yahoo has it. */
export async function getEarningsReactions(symbol: string, n = 10): Promise<EarningsReaction[]> {
  const sym = symbol.toUpperCase();

  // 1) Earnings announcement dates from EDGAR 8-K item 2.02 (newest first), with
  //    each filing's acceptance time (ET) so we know before-open vs after-close.
  let dates: string[] = [];
  const acceptByDate = new Map<string, string>();
  try {
    const { filings } = await getFilings(sym, 0, 300);
    for (const f of filings) if (f.isEarnings && !acceptByDate.has(f.date)) acceptByDate.set(f.date, f.acceptance);
    dates = [...acceptByDate.keys()].slice(0, n + 2);
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

  // 4) Reaction per earnings date. A company can report BEFORE the open (the
  //    reaction is that same session's move) or AFTER the close (it shows up the
  //    NEXT session). We locate the announcement's own trading session by date
  //    (not by timestamp ordering, which lands a day off), then take the larger-
  //    magnitude of [that session's move] vs [the next session's move] — i.e. the
  //    earnings reaction whichever way it was reported.
  const dstr = (t: number) => new Date(t).toISOString().slice(0, 10);
  const out: EarningsReaction[] = [];
  for (const d of dates) {
    let idx = closes.findIndex((b) => dstr(b.t) === d); // the announcement's trading session
    if (idx < 0) idx = closes.findIndex((b) => dstr(b.t) > d); // non-trading day → next session
    if (idx < 1 || idx + 1 >= closes.length) continue;
    const moveOn = closes[idx].c / closes[idx - 1].c - 1; // before-open reporters
    const moveNext = closes[idx + 1].c / closes[idx].c - 1; // after-close reporters
    // Use the 8-K acceptance hour (ET) when we have it: ≥16:00 → after-close
    // (reaction is the next session), <10:00 → before-open (reaction is this
    // session). Only mid-day/unknown filings fall back to the larger move.
    const accept = acceptByDate.get(d) || "";
    const hour = accept.length >= 13 ? parseInt(accept.slice(11, 13), 10) : NaN;
    let move: number, j: number;
    if (hour >= 16) { move = moveNext; j = idx + 1; }
    else if (hour >= 0 && hour < 10) { move = moveOn; j = idx; }
    else { const useOn = Math.abs(moveOn) >= Math.abs(moveNext); move = useOn ? moveOn : moveNext; j = useOn ? idx : idx + 1; }
    const dt = Date.parse(d + "T00:00:00Z"); // for matching the nearest EPS surprise
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
      drift3: j + 3 < closes.length ? closes[j + 3].c / closes[j].c - 1 : null,
      drift5: j + 5 < closes.length ? closes[j + 5].c / closes[j].c - 1 : null,
    });
    if (out.length >= n) break;
  }
  return out;
}
