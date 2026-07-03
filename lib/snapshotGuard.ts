/**
 * Non-destructive snapshot write-guard (data-integrity, phase 2).
 *
 * The nightly/intraday refresh drops any symbol it couldn't quote (build-data.ts:442) and then
 * overwrites `data/<universe>/snapshot.json` unconditionally. So a partial-fetch night — Yahoo
 * rate-limits, returns quotes for 300 of 500 S&P names — silently ships an index missing 200
 * constituents (gapped treemap, truncated breadth, missing movers) until the next run. This is the
 * same "stale/degraded prices" class that has bitten the site before.
 *
 * The guard is a pure decision: refuse to REPLACE a healthy snapshot with one whose row count
 * collapsed. It's the "null ≠ empty — don't destroy good data on a bad night" doctrine we applied
 * to the LLM feeds, ported to the price backbone. Kept pure (no fs) so it's trivially testable and
 * reusable across build-data (US) and build-intl.
 */

export interface SnapshotGuardOpts {
  /** Block the write when nextCount < prevCount * (1 - maxDropRatio). Default 0.15 (a >15% drop). */
  maxDropRatio?: number;
  /**
   * Below this prior count, always allow — a thin prior is itself a bootstrap/half-built file and
   * must never be able to lock the pipeline into keeping bad data. Default 20.
   */
  bootstrapFloor?: number;
}

export interface SnapshotGuardResult {
  allowed: boolean;
  reason: string;
}

/**
 * Decide whether a freshly-built universe snapshot may overwrite the prior one.
 *
 * @param prevCount rows in the existing snapshot on disk (null = no prior / unreadable → allow)
 * @param nextCount rows in the freshly-built snapshot about to be written
 */
export function snapshotWriteAllowed(
  prevCount: number | null,
  nextCount: number,
  opts: SnapshotGuardOpts = {},
): SnapshotGuardResult {
  const maxDropRatio = opts.maxDropRatio ?? 0.15;
  const bootstrapFloor = opts.bootstrapFloor ?? 20;

  // First run / unreadable prior → nothing to protect, allow.
  if (prevCount == null) return { allowed: true, reason: "no prior snapshot — first write allowed" };
  // A prior that was itself thin can't be trusted as the baseline; don't let it block a rebuild.
  if (prevCount < bootstrapFloor) return { allowed: true, reason: `prior count ${prevCount} below bootstrap floor ${bootstrapFloor} — allowed` };

  const minAllowed = prevCount * (1 - maxDropRatio);
  if (nextCount >= minAllowed) {
    return { allowed: true, reason: `${nextCount} vs prior ${prevCount} (within ${Math.round(maxDropRatio * 100)}% tolerance)` };
  }
  const dropPct = Math.round((1 - nextCount / prevCount) * 100);
  return {
    allowed: false,
    reason: `row count collapsed ${dropPct}% (prior ${prevCount} → new ${nextCount}, floor ${Math.round(minAllowed)}) — keeping prior file`,
  };
}
