/**
 * Thirty days of runner outcomes, so "how has the pipeline been doing?" has an answer beyond the last
 * tick. run-tick appends one entry per tick to data/tick-history.json — it rides the R2 tar like
 * tick-report.json and is hydrated back before the next tick, so the file accumulates across ticks and
 * across a container recreate. The status page renders it (components/RunnerHistory).
 *
 * Deliberately small per entry: step names, exits, minutes and suppressed-error counts. No stderr
 * tails — the page is public, and the tails belong in the tick report only.
 *
 * Pure module (no fs) so the client-side status view can import the verdict helper; the status page
 * reads the two files itself.
 */

export interface TickReportStep {
  name: string;
  cmd?: string;
  ok: boolean;
  exit: number | string | null;
  mins: number;
  stderrTail?: string;
  suppressed?: Record<string, number>;
}
/** data/tick-report.json — what run-tick writes for the tick it just ran. */
export interface TickReport {
  generatedAt: string;
  mode: string;
  sha: string;
  node?: string;
  fails: number;
  total: number;
  steps: TickReportStep[];
}

export interface TickEntry {
  /** ISO, end of the tick. */
  at: string;
  mode: string;
  sha: string;
  /** Wall-clock minutes summed over the steps. */
  mins: number;
  fails: number;
  total: number;
  failed: { name: string; exit: number | string | null }[];
  /** Errors the steps swallowed on purpose (lib/scriptKit.swallow), summed. */
  suppressed: number;
  /** Per step, only the non-zero ones. */
  suppressedBy?: Record<string, number>;
}
export interface TickHistory {
  generatedAt: string;
  keepDays: number;
  ticks: TickEntry[];
}

export const TICK_HISTORY_DAYS = 30;
/** Hourly quote ticks make ~700 entries a month; cap the file regardless of the day window. */
export const TICK_HISTORY_MAX = 800;

const sum = (o: Record<string, number> | undefined) => Object.values(o ?? {}).reduce((a, b) => a + b, 0);

/** One history row from a tick report. */
export function summarizeTick(r: TickReport): TickEntry {
  const suppressedBy: Record<string, number> = {};
  for (const s of r.steps) { const n = sum(s.suppressed); if (n > 0) suppressedBy[s.name] = n; }
  const entry: TickEntry = {
    at: r.generatedAt,
    mode: r.mode,
    sha: r.sha,
    mins: +r.steps.reduce((a, s) => a + (Number.isFinite(s.mins) ? s.mins : 0), 0).toFixed(1),
    fails: r.fails,
    total: r.total,
    failed: r.steps.filter((s) => !s.ok).map((s) => ({ name: s.name, exit: s.exit })),
    suppressed: sum(suppressedBy),
  };
  if (Object.keys(suppressedBy).length) entry.suppressedBy = suppressedBy;
  return entry;
}

/** Append one tick, dropping anything older than the window (measured from the new tick) and any
 *  entry with the same `at` (a re-run of the same report). Oldest first. */
export function appendTickHistory(prev: TickHistory | null | undefined, entry: TickEntry, keepDays = TICK_HISTORY_DAYS): TickHistory {
  const cutoff = Date.parse(entry.at) - keepDays * 86_400_000;
  const kept = (prev?.ticks ?? []).filter((t) => t.at !== entry.at && Date.parse(t.at) >= cutoff);
  kept.push(entry);
  kept.sort((a, b) => a.at.localeCompare(b.at));
  return { generatedAt: entry.at, keepDays, ticks: kept.slice(-TICK_HISTORY_MAX) };
}

/** The outcome of one tick: "ok" | "partial" (some steps failed) | "broken" (a majority did). */
export function tickVerdict(t: Pick<TickEntry, "fails" | "total">): "ok" | "partial" | "broken" {
  if (t.fails === 0) return "ok";
  return t.total > 0 && t.fails > t.total / 2 ? "broken" : "partial";
}

/** ET calendar day of an instant — the runner's day is the market's day. */
export const etDay = (iso: string): string => new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/New_York" });

export interface DayCell { day: string; verdict: "ok" | "partial" | "broken" | "none"; ticks: number; fails: number }

/** One cell per ET day for the strip on the status page: the WORST verdict that day. The window ends
 *  on the newest tick's day (not "now") so the server and the browser render the same strip. */
export function dayCells(ticks: readonly TickEntry[], days = TICK_HISTORY_DAYS): DayCell[] {
  if (!ticks.length) return [];
  const newest = ticks.reduce((a, b) => (a.at > b.at ? a : b));
  const byDay = new Map<string, DayCell>();
  for (const t of ticks) {
    const day = etDay(t.at);
    const cell = byDay.get(day) ?? { day, verdict: "none" as const, ticks: 0, fails: 0 };
    const v = tickVerdict(t);
    const rank = { none: 0, ok: 1, partial: 2, broken: 3 };
    byDay.set(day, { day, verdict: rank[v] > rank[cell.verdict] ? v : cell.verdict, ticks: cell.ticks + 1, fails: cell.fails + t.fails });
  }
  const end = Date.parse(`${etDay(newest.at)}T12:00:00Z`); // noon UTC keeps the day arithmetic DST-proof
  const out: DayCell[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date(end - i * 86_400_000).toISOString().slice(0, 10);
    out.push(byDay.get(day) ?? { day, verdict: "none", ticks: 0, fails: 0 });
  }
  return out;
}

/** Type guards for the two files the status page reads (a malformed file must read as absent). */
export const isTickHistory = (v: unknown): v is TickHistory => !!v && typeof v === "object" && Array.isArray((v as TickHistory).ticks);
export const isTickReport = (v: unknown): v is TickReport => !!v && typeof v === "object" && Array.isArray((v as TickReport).steps);
