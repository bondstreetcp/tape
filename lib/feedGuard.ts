/**
 * Non-destructive FEED write-guard — the sibling of lib/snapshotGuard, for the JSON feeds.
 *
 * The 2026-07-15 buybacks incident is the whole argument. `refresh-buybacks` pulls SEC companyfacts
 * per name; when SEC 403s/times out, every fetch returns null, every row filters out, and the script
 * runs happily to completion and does this:
 *
 *     const rows = built.filter(Boolean);        // → []
 *     await fs.writeFile(OUT, JSON.stringify({ rows }));   // ← overwrites 495 GOOD rows with zero
 *
 * The freshness monitor caught it ("only 0 rows (floor 300) — feed produced ~nothing") — but only
 * AFTER the good data was gone, and the board had already lost its data (and Confluence silently lost
 * its buyback signal). Detection is not prevention. A bad night must degrade a feed to STALE, never
 * to DESTROYED: stale-but-real data still renders and still alerts; an empty file just breaks things.
 *
 * Same doctrine as snapshotGuard ("null ≠ empty — don't destroy good data on a bad night"), and the
 * decision math is literally snapshotWriteAllowed, reused. What this adds is that the floor is
 * SINGLE-SOURCED from lib/dataFreshness's registry: the same countPath/minCount the monitor reports on
 * is what the writer enforces, so the two can never drift apart.
 *
 * Server/tooling only (reads + writes data/ with fs) — call it from refresh scripts.
 */
import { promises as fs } from "fs";
import path from "path";
import { feedSpec, feedCount } from "./dataFreshness";
import { snapshotWriteAllowed } from "./snapshotGuard";

export interface FeedWriteResult {
  written: boolean;
  reason: string;
  prevCount: number | null;
  nextCount: number | null;
}

/**
 * Write `data` to data/<file> unless doing so would collapse a healthy feed.
 *
 * Blocks when BOTH hold:
 *   - the row count dropped more than `maxDropRatio` (default 15%) vs the file already on disk, and
 *   - the new count is below the registry's declared `minCount` floor.
 *
 * Requiring both is deliberate. A drop alone can be legitimate (a genuinely quieter day); a count
 * under the floor with no prior to compare is a first/bootstrap run and must not be blocked forever.
 * It's the combination — "we had a healthy feed, and what we just built is both much smaller AND
 * below the level this feed is known-broken beneath" — that means the run failed, not the market.
 *
 * Feeds with no `countPath`/`minCount` in the registry are uncountable-by-design (age-only, e.g. the
 * sparse event feeds) and always write: there is no honest signal to gate on.
 *
 * Returns { written:false } rather than throwing — the caller decides whether a blocked write is a
 * hard failure (exit 1, so the tick logs ✗ and the freshness gate sees stale data) or a soft skip.
 */
export async function writeFeedGuarded(
  file: string,
  data: unknown,
  /** `replacer` is passed through to JSON.stringify — vol-cone rounds every number to 4dp this way
   *  to keep its file small, and the guard must not silently undo that. */
  opts: { maxDropRatio?: number; dataDir?: string; replacer?: (key: string, value: any) => any } = {},
): Promise<FeedWriteResult> {
  const dataDir = opts.dataDir ?? path.join(process.cwd(), "data");
  const abs = path.join(dataDir, file);
  const spec = feedSpec(file);
  const nextCount = feedCount(spec, data);
  const encode = () => JSON.stringify(data, opts.replacer);

  // Uncountable feed (no countPath) or no declared floor → nothing to guard on; write.
  if (nextCount == null || spec?.minCount == null) {
    await fs.writeFile(abs, encode());
    return { written: true, reason: spec ? "no countPath/minCount floor declared — write allowed" : `${file} is not in the freshness registry — write allowed`, prevCount: null, nextCount };
  }

  let prevCount: number | null = null;
  try {
    prevCount = feedCount(spec, JSON.parse(await fs.readFile(abs, "utf8")));
  } catch {
    prevCount = null; // missing / unreadable prior → nothing to protect
  }

  const guard = snapshotWriteAllowed(prevCount, nextCount, {
    maxDropRatio: opts.maxDropRatio ?? 0.15,
    // A prior thinner than the floor is itself a broken file — it must never be able to lock the
    // pipeline into keeping bad data forever.
    bootstrapFloor: spec.minCount,
  });

  // Above the floor = a real feed even if it shrank; only a sub-floor collapse is blocked.
  if (guard.allowed || nextCount >= spec.minCount) {
    await fs.writeFile(abs, encode());
    return { written: true, reason: nextCount >= spec.minCount ? `${nextCount} rows (floor ${spec.minCount}) — write allowed` : guard.reason, prevCount, nextCount };
  }

  return {
    written: false,
    reason: `${guard.reason}; new count ${nextCount} is also below the floor ${spec.minCount} — KEEPING the prior file (it will read as stale, which is honest; an empty feed is not)`,
    prevCount,
    nextCount,
  };
}
