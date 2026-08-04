/**
 * Universe row carry-forward — a listed name that fails to fetch goes STALE, never MISSING.
 *
 * WHY THIS EXISTS
 * --------------------------------------------------------------------------------------------------
 * scripts/build-data.ts drops any constituent whose quote came back without a market cap or price:
 *
 *     if (!c?.etf || !m || !m.marketCap || !m.price) continue;   // build-data.ts
 *
 * That is correct for junk rows and catastrophic for transient failures, and Yahoo produces a lot of
 * the latter on a 2,600-name pull. MEASURED 2026-07-30: the Russell 3000 snapshot held 2,228 of 2,593
 * real constituents — **365 names, 14%, silently absent**, among them MTCH, HUM ($45bn), LNG ($54bn),
 * DVN ($51bn), MTD ($29bn). Re-probing 41 of them found 21 fetching perfectly a few hours later. They
 * were never delisted; the build simply asked at a bad moment and dropped them without a word.
 *
 * The same night the Russell 1000 lost 5 of 1,003 (0.5%) — the failure rate scales with how hard the
 * run leans on the vendor, so the broadest universe (the one whose whole point is breadth) is hit
 * worst.
 *
 * WHY IT WENT UNNOTICED — and this is the part worth remembering. lib/snapshotGuard compares each
 * write against THE PREVIOUS SNAPSHOT and blocks a drop over 15%. That catches a cliff and is blind to
 * erosion: lose 13% one night, 13% of the remainder the next, and every single write is "within
 * tolerance" while the universe ratchets away. A relative guard cannot see a slow leak — only a check
 * against the ABSOLUTE expected count can, which is what `coverageShortfall` below is for.
 *
 * THE FIX is the doctrine this codebase already applies to feeds (lib/feedGuard: degrade to stale,
 * never to empty), pushed down to the row. A name the index still lists, that we have seen before and
 * simply could not reach tonight, keeps its previous row and is stamped `staleSince`. A stale price is
 * a visible, bounded, self-correcting imperfection; a vanished row is an invisible one — it silently
 * shrinks every screen, board and breadth statistic computed over the universe, and nothing downstream
 * can tell the difference between "not in the index" and "we failed to fetch it".
 *
 * The carry is BOUNDED so a genuinely delisted name cannot live forever: past `maxCarryDays` it is
 * dropped for real. That bound is what keeps this from becoming a slow accumulation of ghosts.
 */
import { daysUntil } from "./calendar";

/** The minimum shape this module needs; StockRow satisfies it. */
export interface CarryableRow {
  symbol: string;
  /** ISO calendar day (YYYY-MM-DD) this row was last built from a live fetch; absent = fresh today. */
  staleSince?: string | null;
}

export interface CarryOpts {
  /** Days a carried row may persist before it is treated as genuinely gone. Default 7. */
  maxCarryDays?: number;
  /** Now, in ms. Injected so the behaviour is testable without touching the clock. */
  nowMs?: number;
}

export interface CarryResult<T> {
  rows: T[];
  /** listed, fetched fine this run */
  fresh: string[];
  /** listed, fetch failed, served from the prior snapshot */
  carried: string[];
  /** listed, fetch failed, prior row too old to keep — dropped for real */
  expired: string[];
  /** listed, no fresh row and no prior row — nothing we can do */
  unknown: string[];
}

/** UTC calendar day, matching the bare-YYYY-MM-DD convention `daysUntil` expects. */
export function todayISO(nowMs: number = Date.now()): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Merge this run's rows with the prior snapshot over the index's constituent list.
 *
 * Order follows `listed`, so the snapshot's row order tracks the index rather than fetch timing.
 * A fresh row always wins and has its staleness cleared — recovery is automatic and needs no
 * bookkeeping, which is what makes this safe to leave switched on.
 */
export function carryForwardRows<T extends CarryableRow>(
  listed: string[],
  fresh: Map<string, T>,
  prior: Map<string, T>,
  opts: CarryOpts = {},
): CarryResult<T> {
  const maxCarryDays = opts.maxCarryDays ?? 7;
  const nowMs = opts.nowMs ?? Date.now();
  const today = todayISO(nowMs);

  const out: CarryResult<T> = { rows: [], fresh: [], carried: [], expired: [], unknown: [] };
  const seen = new Set<string>();

  for (const symbol of listed) {
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);

    const live = fresh.get(symbol);
    if (live) {
      // Clear any prior staleness — this row is current again.
      out.rows.push(live.staleSince ? ({ ...live, staleSince: null } as T) : live);
      out.fresh.push(symbol);
      continue;
    }

    const old = prior.get(symbol);
    if (!old) { out.unknown.push(symbol); continue; }

    // First failure stamps today; subsequent failures keep the ORIGINAL stamp, so the carry window
    // measures how long the name has actually been unreachable rather than resetting every night.
    const since = old.staleSince || today;
    // daysUntil returns negative for past days; a bare YYYY-MM-DD is a calendar square, not an
    // instant, so this must not be an ms subtraction.
    const d = daysUntil(since, nowMs);
    const ageDays = d == null ? 0 : -d;
    if (ageDays > maxCarryDays) { out.expired.push(symbol); continue; }

    out.rows.push({ ...old, staleSince: since } as T);
    out.carried.push(symbol);
  }

  return out;
}

/**
 * Absolute coverage check — the thing a relative write-guard structurally cannot do.
 *
 * `snapshotWriteAllowed` asks "is tonight much worse than last night?". This asks "is tonight much
 * worse than the INDEX SAYS IT SHOULD BE?", which is the only question that catches a slow leak.
 * Returns the shortfall as a fraction of the expected count, plus a boolean at the given tolerance.
 */
export function coverageShortfall(built: number, expected: number, tolerance = 0.05): {
  shortfall: number; ok: boolean; missing: number;
} {
  if (!expected || expected <= 0) return { shortfall: 0, ok: true, missing: 0 };
  const missing = Math.max(0, expected - built);
  const shortfall = missing / expected;
  return { shortfall, ok: shortfall <= tolerance, missing };
}
