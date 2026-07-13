/**
 * Signal Track Record — logs each idea board's membership the day a name APPEARS, then grades every
 * appearance on what the stock actually did over the next 1w / 1m / 3m (vs the S&P 500). The boards
 * (Confluence, Warnings, Coiled Springs, Leaders breakouts, Squeeze, Revisions, Insiders, Smart-Money,
 * Distribution, Positioning) are rebuilt and OVERWRITTEN nightly, so without this log no history accrues
 * and "do these signals actually work?" is unanswerable. Forward-only, like the earnings-play track
 * record: we log live and grade later — no backfill, no survivorship games.
 *
 * CLIENT-SAFE: types + pure log/mark/summarize math only (no fs, no network). The nightly script
 * (scripts/refresh-signal-log.ts) rebuilds each board with the SAME lib builders the pages use — the
 * logger and the board can't drift (the "logger == card by construction" doctrine).
 */

export type SignalDirection = "bullish" | "bearish" | "move";

export type SignalKey =
  | "confluence"
  | "warnings"
  | "smartmoney"
  | "distribution"
  | "squeeze"
  | "revisions"
  | "leaders"
  | "insiders"
  | "coiled"
  | "positioning-bull"
  | "positioning-bear";

export const SIGNAL_META: Record<SignalKey, { label: string; color: string; direction: SignalDirection; path: string; desc: string }> = {
  confluence: { label: "Confluence", color: "#22c55e", direction: "bullish", path: "/confluence", desc: "Several independent bullish signals stacked on one name" },
  warnings: { label: "Warning Signs", color: "#ef4444", direction: "bearish", path: "/warnings", desc: "Several independent bearish signals stacked on one name" },
  smartmoney: { label: "Smart-Money Radar", color: "#38bdf8", direction: "bullish", path: "/smart-money", desc: "Super-investor 13F adds + Congress buys" },
  distribution: { label: "Distribution", color: "#f59e0b", direction: "bearish", path: "/distribution", desc: "2+ super-investors exited or sharply trimmed" },
  squeeze: { label: "Short-Squeeze Radar", color: "#a78bfa", direction: "bullish", path: "/squeeze", desc: "Crowded shorts with squeeze fuel (top of the composite score)" },
  revisions: { label: "Revisions Momentum", color: "#60a5fa", direction: "bullish", path: "/revisions", desc: "The Street quietly raising estimates (top of the composite score)" },
  leaders: { label: "Leaders Breakout", color: "#4ade80", direction: "bullish", path: "/leaders", desc: "High relative strength + breakout flag (near 52w high, golden cross, above 200-day)" },
  insiders: { label: "Insider Buying", color: "#fbbf24", direction: "bullish", path: "/insiders", desc: "Open-market insider buys (Form 4 clusters)" },
  coiled: { label: "Coiled Springs", color: "#2dd4bf", direction: "move", path: "/coiled", desc: "Realized vol at the bottom of its cone + a dealer accelerant — expects a big move, either way" },
  "positioning-bull": { label: "Positioning (calls)", color: "#86efac", direction: "bullish", path: "/positioning", desc: "Big out-of-the-money CALL premium concentrating in the flow tape" },
  "positioning-bear": { label: "Positioning (puts)", color: "#fca5a5", direction: "bearish", path: "/positioning", desc: "Big out-of-the-money PUT premium concentrating in the flow tape" },
};

export const SIGNAL_KEYS = Object.keys(SIGNAL_META) as SignalKey[];

export type HorizonKey = "w1" | "m1" | "m3";
/** Calendar-day horizons (a mark fills on the first nightly run ON/AFTER the boundary). */
export const HORIZONS: { key: HorizonKey; days: number; label: string }[] = [
  { key: "w1", days: 7, label: "1w" },
  { key: "m1", days: 30, label: "1m" },
  { key: "m3", days: 91, label: "3m" },
];

/** Don't re-log the same signal+symbol within this window of its LAST LOG — throttles churny cycles. */
export const RELOG_COOLDOWN_DAYS = 30;
/** A reappearance only counts as a NEW signal after this many days OFF the board — a name that dips
 * off for a night (rank churn at the cap boundary) and comes right back is a flicker, not a signal. */
export const MIN_ABSENCE_DAYS = 7;
/** A due mark may fill at most this many days late (symbol missing from the snapshot, run outages…).
 * Later than that, the window no longer measures the horizon it claims — leave it unfilled. */
export const MARK_GRACE_DAYS = 14;

export interface SignalMark {
  date: string; // YYYY-MM-DD the mark was captured (first run on/after the horizon)
  price: number;
  spx: number | null; // S&P 500 close the same day (benchmark leg)
}

export interface SignalEvent {
  id: string; // `${signal}|${symbol}|${date}`
  signal: SignalKey;
  symbol: string;
  name: string;
  sector?: string | null;
  date: string; // YYYY-MM-DD the name APPEARED on the board (UTC)
  entryPrice: number;
  spxEntry: number | null;
  score?: number | null; // the board's own score at entry, where it has one
  note?: string; // tiny context, e.g. "3 signals" / "springScore 84"
  /** Composition at entry — for Confluence/Warnings, WHICH signal kinds the name carried. Powers the
   * per-kind attribution ("does insider-carrying confluence beat options-carrying?"). Logged from
   * 2026-07-12; earlier events pre-date it and stay unattributed. */
  tags?: string[];
  seed?: boolean; // logged on the signal's FIRST run (whole board, not a fresh appearance)
  marks: Partial<Record<HorizonKey, SignalMark>>;
}

export interface SignalLogFile {
  generatedAt: string;
  since: string; // first log date
  events: SignalEvent[];
  /** Membership at the last run (PRICED members only — an unpriced name keeps retrying nightly). */
  lastMembership: Partial<Record<SignalKey, string[]>>;
  /** symbol → last date seen on the board, per signal — anchors the flicker guard to board PRESENCE,
   * not log date (a name present 45d straight must not re-log after a one-night dip off the cap). */
  lastSeen?: Partial<Record<SignalKey, Record<string, string>>>;
}

export interface MemberInput {
  symbol: string;
  name: string;
  sector?: string | null;
  score?: number | null;
  note?: string;
  tags?: string[]; // composition at entry (e.g. confluence signal kinds) — stored on the event
}

/** A board name's entry in this log, joined back onto its board by the server page — closes the
 * accountability loop AT the board: when was this name flagged, and what has it done since. */
export interface FlaggedInfo {
  date: string; // YYYY-MM-DD the name was logged (this stint on the board)
  entryPrice: number; // nightly close the day it was flagged
  isNew: boolean; // appeared on the latest tracked run (a fresh entrant, not a seed)
  seed: boolean; // was already on the board the night tracking began
}

/** Pure board×log join (lib/flaggedJoin does the fs read): for each board symbol, its LATEST log
 * entry for `signal` — i.e. this stint on the board (a re-entry after a real absence measures from
 * its own flag date, matching the log's episode model). isNew = a non-seed entry dated on the
 * latest tracked run (the newest lastSeen stamp — every priced member is stamped each run). Null
 * when the log holds nothing for these symbols. ⚠ Prices are NOT re-based across stock splits —
 * same known limit as the marks (see the header). */
export function joinFlagged(log: SignalLogFile, signal: SignalKey, symbols: Set<string>): Record<string, FlaggedInfo> | null {
  if (!log?.events?.length) return null;
  const latest = new Map<string, SignalEvent>();
  for (const e of log.events) {
    if (e.signal !== signal || !symbols.has(e.symbol) || !(e.entryPrice > 0)) continue;
    const p = latest.get(e.symbol);
    if (!p || e.date > p.date) latest.set(e.symbol, e); // YYYY-MM-DD → lexicographic is chronological
  }
  if (!latest.size) return null;
  const seenDates = Object.values(log.lastSeen?.[signal] ?? {});
  const lastRun = seenDates.length ? seenDates.reduce((a, b) => (a > b ? a : b)) : null;
  const out: Record<string, FlaggedInfo> = {};
  for (const [sym, e] of latest)
    out[sym] = { date: e.date, entryPrice: e.entryPrice, isNew: !e.seed && lastRun != null && e.date === lastRun, seed: !!e.seed };
  return out;
}

/** Whole calendar days between two YYYY-MM-DD dates (both pinned to UTC midnight — no TZ drift). */
export function daysBetween(fromISO: string, toISO: string): number {
  return Math.round((Date.parse(toISO + "T00:00:00Z") - Date.parse(fromISO + "T00:00:00Z")) / 86_400_000);
}

/** Which of today's members are NEW appearances to log. First-ever run for a signal (prevMembers
 * undefined) seeds the whole board (flagged `seed`). After that a name logs only when (a) it wasn't in
 * the previous run's membership, (b) it's been OFF the board ≥ MIN_ABSENCE_DAYS (lastSeen — a
 * one-night dip below the cap is churn), and (c) it hasn't logged within RELOG_COOLDOWN_DAYS. */
export function pickNewEntries(
  signal: SignalKey,
  current: MemberInput[],
  prevMembers: string[] | undefined,
  lastSeen: Record<string, string> | undefined,
  events: SignalEvent[],
  todayISO: string,
): { member: MemberInput; seed: boolean }[] {
  const firstRun = prevMembers === undefined;
  const prev = new Set(prevMembers ?? []);
  const recentlyLogged = new Set(
    events
      .filter((e) => e.signal === signal && daysBetween(e.date, todayISO) < RELOG_COOLDOWN_DAYS)
      .map((e) => e.symbol),
  );
  const seen = new Set<string>();
  const out: { member: MemberInput; seed: boolean }[] = [];
  for (const m of current) {
    if (!m.symbol || seen.has(m.symbol)) continue;
    seen.add(m.symbol);
    if (recentlyLogged.has(m.symbol)) continue;
    if (!firstRun && prev.has(m.symbol)) continue;
    const seenDate = lastSeen?.[m.symbol];
    if (!firstRun && seenDate && daysBetween(seenDate, todayISO) < MIN_ABSENCE_DAYS) continue; // flicker
    out.push({ member: m, seed: firstRun });
  }
  return out;
}

/** Fill any due, unfilled marks in place (first run on/after each horizon boundary). Three guards:
 * a symbol with no price today stays unfilled (retries next run); a null S&P close skips the WHOLE
 * fill (a transient benchmark outage must not bake spx:null into permanent marks — next run fills one
 * day later); and a mark more than MARK_GRACE_DAYS late is never filled — a 5-month-late price is not
 * a "1-week return", it would poison all three horizon buckets with the same number. */
export function applyDueMarks(
  events: SignalEvent[],
  priceBy: Map<string, number>,
  spx: number | null,
  todayISO: string,
): number {
  if (spx == null) return 0;
  let filled = 0;
  for (const e of events) {
    const age = daysBetween(e.date, todayISO);
    for (const h of HORIZONS) {
      if (age < h.days || age > h.days + MARK_GRACE_DAYS || e.marks[h.key]) continue;
      const price = priceBy.get(e.symbol);
      if (!(price && price > 0)) continue;
      e.marks[h.key] = { date: todayISO, price, spx };
      filled++;
    }
  }
  return filled;
}

export interface EventReturn {
  ret: number; // simple return entry → mark
  spxRet: number | null; // benchmark return over the same window
  excess: number | null; // ret − spxRet
}

/** Return of one event at one horizon, with the S&P leg over the SAME dates. Null until marked. */
export function eventReturn(e: SignalEvent, h: HorizonKey): EventReturn | null {
  const m = e.marks[h];
  if (!m || !(e.entryPrice > 0)) return null;
  const ret = m.price / e.entryPrice - 1;
  const spxRet = m.spx != null && e.spxEntry != null && e.spxEntry > 0 ? m.spx / e.spxEntry - 1 : null;
  return { ret, spxRet, excess: spxRet != null ? ret - spxRet : null };
}

/** Direction-adjusted "edge" of one event-return — the number where BIGGER IS ALWAYS BETTER:
 * bullish = the excess return over the S&P; bearish = the NEGATIVE of that (a fall or a lag is a win);
 * move = how much MORE the stock moved than the index, absolute. ALL definitions need the benchmark —
 * an event without one contributes nothing (mixing raw returns into an "excess" average would report
 * pure market beta as edge; raw performance is already captured by avgRet and hitRate). */
export function edgeOf(direction: SignalDirection, r: EventReturn): number | null {
  if (direction === "move") return r.spxRet == null ? null : Math.abs(r.ret) - Math.abs(r.spxRet);
  if (r.excess == null) return null;
  return direction === "bullish" ? r.excess : -r.excess;
}

export interface HorizonSummary {
  n: number; // graded events
  avgRet: number; // mean raw return
  medRet: number;
  hitRate: number | null; // share of "wins" (bullish: ret>0; bearish: ret<0; move: |ret|>|spx ret|)
  hitN: number; // events the hit-rate is over (move needs the benchmark)
  avgExcess: number | null; // mean (ret − spx) where benchmark known
  avgEdge: number | null; // mean direction-adjusted edge (bigger = better for EVERY direction)
}

export interface SignalSummary {
  signal: SignalKey;
  events: number;
  open: number; // logged but not yet fully graded (some mark still unfilled & not yet due… simply: missing m3)
  horizons: Partial<Record<HorizonKey, HorizonSummary>>;
}

const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};

/** Aggregate one horizon over a set of graded events — shared by the per-signal and per-tag
 * summaries so the two scorecards can't drift. Null when nothing has reached the horizon. */
function horizonSummary(evs: SignalEvent[], h: HorizonKey, dir: SignalDirection): HorizonSummary | null {
  const rets: EventReturn[] = [];
  for (const e of evs) {
    const r = eventReturn(e, h);
    if (r) rets.push(r);
  }
  if (!rets.length) return null;
  const raw = rets.map((r) => r.ret);
  const excess = rets.map((r) => r.excess).filter((x): x is number => x != null);
  const edges = rets.map((r) => edgeOf(dir, r)).filter((x): x is number => x != null);
  let hitN = 0, hits = 0;
  for (const r of rets) {
    if (dir === "move") {
      if (r.spxRet == null) continue;
      hitN++;
      if (Math.abs(r.ret) > Math.abs(r.spxRet)) hits++;
    } else {
      hitN++;
      if (dir === "bullish" ? r.ret > 0 : r.ret < 0) hits++;
    }
  }
  return {
    n: rets.length,
    avgRet: mean(raw),
    medRet: median(raw),
    hitRate: hitN ? hits / hitN : null,
    hitN,
    avgExcess: excess.length ? mean(excess) : null,
    avgEdge: edges.length ? mean(edges) : null,
  };
}

/** Aggregate every graded event per signal per horizon. Seed events (the first run's whole board)
 * are included — they're real forward-looking entries too — but callers can filter them out. */
export function summarizeSignals(events: SignalEvent[], opts: { includeSeed?: boolean } = {}): SignalSummary[] {
  const includeSeed = opts.includeSeed ?? true;
  const out: SignalSummary[] = [];
  for (const signal of SIGNAL_KEYS) {
    const dir = SIGNAL_META[signal].direction;
    const evs = events.filter((e) => e.signal === signal && (includeSeed || !e.seed));
    // A tracked signal with zero events still gets a row (e.g. Coiled Springs on a night with no
    // coiled setups) — vanishing from the scorecard reads as "not tracked", which is wrong.
    const horizons: SignalSummary["horizons"] = {};
    for (const h of HORIZONS) {
      const hz = horizonSummary(evs, h.key, dir);
      if (hz) horizons[h.key] = hz;
    }
    out.push({ signal, events: evs.length, open: evs.filter((e) => !e.marks.m3).length, horizons });
  }
  return out;
}

export interface TagSummary {
  tag: string; // e.g. a Confluence signal kind ("insider", "buyback"…)
  events: number; // tagged entries carrying this tag
  open: number; // of those, not yet past the 3-month check
  horizons: Partial<Record<HorizonKey, HorizonSummary>>;
}

/** Per-tag attribution WITHIN one signal's events — e.g. "how did Confluence names carrying the
 * insider kind do vs those carrying options flow?" An entry with several tags counts toward each
 * (the question is conditional performance, not an orthogonal factor decomposition — the how-to-read
 * says so). Only events logged WITH tags contribute; the pre-tagging backlog stays out rather than
 * polluting the attribution with unattributable entries. */
export function summarizeTags(events: SignalEvent[], signal: SignalKey, opts: { includeSeed?: boolean } = {}): TagSummary[] {
  const includeSeed = opts.includeSeed ?? true;
  const dir = SIGNAL_META[signal].direction;
  const byTag = new Map<string, SignalEvent[]>();
  for (const e of events) {
    if (e.signal !== signal || !e.tags?.length || (!includeSeed && e.seed)) continue;
    // Set-dedupe: the producers guarantee one-per-kind, but a duplicated tag must never
    // double-count an event in its own bucket.
    for (const t of new Set(e.tags)) {
      const a = byTag.get(t) ?? [];
      a.push(e);
      byTag.set(t, a);
    }
  }
  const out: TagSummary[] = [];
  for (const [tag, evs] of byTag) {
    const horizons: TagSummary["horizons"] = {};
    for (const h of HORIZONS) {
      const hz = horizonSummary(evs, h.key, dir);
      if (hz) horizons[h.key] = hz;
    }
    out.push({ tag, events: evs.length, open: evs.filter((e) => !e.marks.m3).length, horizons });
  }
  out.sort((a, b) => b.events - a.events || a.tag.localeCompare(b.tag));
  return out;
}
