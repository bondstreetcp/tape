/**
 * Idea Inbox — the idea-generation workflow's front door (2026-08, the workflow-sharpening pass).
 * ~11 idea boards each rank names nightly, but discovery was menu-diving: nothing answered "what
 * ARRIVED across all of them, and which arrivals does the evidence say to take seriously?"
 *
 * This is a PURE VIEW over the signal log — the same forward-accumulating record /signal-record
 * grades. An "arrival" is a SignalEvent (the log's whole design: a name newly appearing on a board,
 * with flicker guards, re-log cooldowns, and split-adjusted grading already engineered there). The
 * inbox fuses arrivals by name and weights each board by its OWN GRADED RECORD (1-month
 * direction-adjusted edge vs the S&P) — a board that hasn't proven anything gets a small neutral
 * weight, a board with a negative record contributes ~nothing, and the weights are shown on the
 * page, not hidden. No new feed, no LLM: the log is the source of truth and the inbox inherits its
 * integrity.
 */
import { SIGNAL_META, type SignalDirection, type SignalEvent, type SignalKey, type SignalSummary } from "./signalLog";

/** m1 sample size below which a board's record is treated as unproven. */
export const MIN_GRADED = 15;
/** The weight an unproven board gets — arrivals still surface, they just don't dominate. */
export const NEUTRAL_WEIGHT = 0.5;

export interface BoardWeight {
  signal: SignalKey;
  label: string;
  color: string;
  path: string;
  weight: number; // max(0, m1 avgEdge) once proven; NEUTRAL_WEIGHT before that
  n: number; // graded m1 events behind the weight (0 = unproven)
}

export interface IdeaArrival {
  signal: SignalKey;
  label: string;
  color: string;
  path: string;
  direction: SignalDirection;
  date: string; // YYYY-MM-DD the name appeared on the board
  daysAgo: number;
  note?: string;
  weight: number;
}

export interface IdeaRow {
  symbol: string;
  name: string;
  sector: string | null;
  /** contested = bullish AND bearish boards both flagged it inside the window — itself a finding */
  direction: SignalDirection | "contested";
  score: number;
  latest: string; // freshest arrival date
  arrivals: IdeaArrival[];
}

export interface IdeaInbox {
  rows: IdeaRow[];
  weights: BoardWeight[];
  windowDays: number;
}

const DAY = 86_400_000;

/** Per-board weight from the graded record: the 1-month direction-adjusted edge, floored at zero
 *  (a bad record means "no evidence", not "evidence against the name"). */
export function boardWeights(summaries: SignalSummary[]): BoardWeight[] {
  return summaries.map((s) => {
    const m1 = s.horizons.m1;
    const proven = !!m1 && m1.n >= MIN_GRADED && m1.avgEdge != null;
    const meta = SIGNAL_META[s.signal];
    return {
      signal: s.signal,
      label: meta.label,
      color: meta.color,
      path: meta.path,
      weight: proven ? Math.max(0, m1!.avgEdge!) : NEUTRAL_WEIGHT,
      n: proven ? m1!.n : 0,
    };
  });
}

export function buildIdeaInbox(
  events: SignalEvent[],
  summaries: SignalSummary[],
  opts: { windowDays?: number; nowMs: number },
): IdeaInbox {
  const windowDays = opts.windowDays ?? 14;
  const todayMs = Math.floor(opts.nowMs / DAY) * DAY;
  const weights = boardWeights(summaries);
  const wBy = new Map(weights.map((w) => [w.signal, w]));

  const bySym = new Map<string, { name: string; sector: string | null; arrivals: IdeaArrival[] }>();
  for (const e of events) {
    if (e.seed) continue; // a seed row is the board's whole standing list at launch, not an arrival
    const t = Date.parse(e.date);
    if (!Number.isFinite(t)) continue;
    const daysAgo = Math.round((todayMs - t) / DAY);
    if (daysAgo < 0 || daysAgo > windowDays) continue;
    const meta = SIGNAL_META[e.signal];
    const w = wBy.get(e.signal);
    const cur = bySym.get(e.symbol) ?? { name: e.name, sector: e.sector ?? null, arrivals: [] };
    cur.arrivals.push({
      signal: e.signal,
      label: meta.label,
      color: meta.color,
      path: meta.path,
      direction: meta.direction,
      date: e.date,
      daysAgo,
      note: e.note,
      weight: w?.weight ?? NEUTRAL_WEIGHT,
    });
    bySym.set(e.symbol, cur);
  }

  const rows: IdeaRow[] = [];
  for (const [symbol, r] of bySym) {
    r.arrivals.sort((a, b) => a.daysAgo - b.daysAgo);
    const dirs = new Set(r.arrivals.map((a) => a.direction));
    const direction: IdeaRow["direction"] =
      dirs.has("bullish") && dirs.has("bearish") ? "contested"
      : dirs.has("bullish") ? "bullish"
      : dirs.has("bearish") ? "bearish"
      : "move";
    // Freshness-decayed weight sum: a today-arrival counts fully, one at the window edge barely.
    // Transparent by construction — each chip shows its board's weight and age on the page.
    const score = r.arrivals.reduce((a, x) => a + x.weight * (1 - x.daysAgo / (windowDays + 1)), 0);
    rows.push({ symbol, name: r.name, sector: r.sector, direction, score: +score.toFixed(2), latest: r.arrivals[0].date, arrivals: r.arrivals });
  }
  rows.sort((a, b) => b.score - a.score || (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : a.symbol.localeCompare(b.symbol)));
  return { rows, weights, windowDays };
}
