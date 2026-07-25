/**
 * In-process TTL memo for LIVE API routes — the CDN the self-hosted origin doesn't have.
 *
 * On Vercel, `Cache-Control: s-maxage` did the heavy lifting: one slow compute, then the CDN served
 * every viewer for hours. The NAS origin has no CDN in front (the Cloudflare Tunnel proxies but does
 * not cache API JSON), so every Earnings-tab view recomputed ~6 live Yahoo calls — 12-17s per view,
 * reading as "the earnings section isn't loading". A single long-lived `next start` process makes an
 * in-memory memo exactly equivalent to that CDN; on serverless each invocation is a fresh process, so
 * this degrades to a harmless per-request no-op there.
 *
 * Semantics (matching the house doctrine):
 *  - IN-FLIGHT DEDUP: concurrent requests for the same key share ONE computation (a 15s compute
 *    stampeded by N tabs must not fan out to N Yahoo bursts).
 *  - cacheIf: only cache results worth keeping (a null AI preview must not brick the key for 3h —
 *    the same lesson as "never CDN-cache {ai:null}").
 *  - SERVE-STALE-ON-ERROR: if a recompute fails and an expired entry exists, serve it (degrade to
 *    STALE, never EMPTY).
 *  - Bounded: ~800 entries, oldest evicted — a universe of symbols fits, runaway keys don't.
 */

interface Entry {
  at: number; // when the value was cached
  ttl: number; // the caller's TTL, kept so eviction can tell dead entries from live ones
  v: unknown;
}

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 800;
/** How long an EXPIRED entry is kept as the serve-stale-on-error reservoir before eviction may reap it. */
const STALE_GRACE_MS = 15 * 60_000;
/** Hard ceiling on serve-stale: past this, a failure is reported rather than answered with old data. */
const STALE_MAX_AGE_MS = 6 * 3_600_000;

export async function memo<T>(
  key: string,
  ttlMs: number,
  fn: () => Promise<T>,
  opts: { cacheIf?: (v: T) => boolean } = {},
): Promise<T> {
  const hit = store.get(key);
  const now = Date.now();
  if (hit && now - hit.at < ttlMs) return hit.v as T;

  // Share an in-flight computation instead of stampeding.
  const running = inflight.get(key);
  if (running) return running as Promise<T>;

  const p = (async () => {
    try {
      const v = await fn();
      if (!opts.cacheIf || opts.cacheIf(v)) {
        store.set(key, { at: Date.now(), v, ttl: ttlMs });
        if (store.size > MAX_ENTRIES) {
          // Drop EXPIRED entries before any live one. Without this, oldest-first eviction is biased
          // against long-TTL keys purely because they were cached longer: a 250-symbol industry poll
          // (30-120s TTLs, constantly re-cached) would evict the 10-minute chart entries that are
          // still perfectly valid, and the most expensive caches would be the first to go. Expired
          // entries are dead weight anyway — reclaiming them usually makes room without any loss.
          // Eviction is TIERED, because two things compete for the same bytes and a single rule gets
          // one of them wrong:
          //   tier 1 — entries past their TTL *and* the grace window: genuinely abandoned, free them all.
          //   tier 2 — expired but still in grace: the serve-stale-on-error reservoir. Evictable, but
          //            only after tier 1, and oldest-first.
          //   tier 3 — live entries: evict the oldest only when nothing else can be reclaimed.
          // Sweeping ALL expired entries (the first attempt) emptied the reservoir and turned vendor
          // outages from STALE into EMPTY; evicting purely oldest-first (the original) let a churning
          // 250-symbol poll push out the expensive long-TTL chart entries. Tiering fixes both, and
          // makes the honest tradeoff explicit: under sustained pressure the reservoir IS reclaimable,
          // because a bounded cache beats an unbounded one.
          const now = Date.now();
          let freed = false;
          for (const [k, e] of store) if (now - e.at >= e.ttl + STALE_GRACE_MS) { store.delete(k); freed = true; }
          if (!freed) {
            let victim: string | null = null, victimAt = Infinity;
            for (const [k, e] of store) if (now - e.at >= e.ttl && e.at < victimAt) { victimAt = e.at; victim = k; }
            if (!victim) for (const [k, e] of store) if (e.at < victimAt) { victimAt = e.at; victim = k; }
            if (victim) store.delete(victim);
          }
        }
      }
      return v;
    } catch (e) {
      // Degrade to STALE, never EMPTY: an expired entry beats a thrown error — but not at ANY age.
      // Serving a six-hour-old option chain as if it were live is worse than admitting failure, so
      // the reservoir has a hard ceiling; past it the error propagates to the caller's own handling.
      const stale = store.get(key);
      if (stale && Date.now() - stale.at < STALE_MAX_AGE_MS) return stale.v as T;
      throw e;
    } finally {
      inflight.delete(key);
    }
  })();
  inflight.set(key, p);
  return p as Promise<T>;
}

/** Test/ops hook — clear everything (never used by app code). */
export function memoClear(): void {
  store.clear();
  inflight.clear();
}
