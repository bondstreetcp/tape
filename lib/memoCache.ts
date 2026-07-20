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
  v: unknown;
}

const store = new Map<string, Entry>();
const inflight = new Map<string, Promise<unknown>>();
const MAX_ENTRIES = 800;

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
        store.set(key, { at: Date.now(), v });
        if (store.size > MAX_ENTRIES) {
          // Evict oldest-cached first (Map preserves insertion order; re-set on refresh keeps this ~LRU).
          let oldestKey: string | null = null, oldestAt = Infinity;
          for (const [k, e] of store) if (e.at < oldestAt) { oldestAt = e.at; oldestKey = k; }
          if (oldestKey) store.delete(oldestKey);
        }
      }
      return v;
    } catch (e) {
      // Degrade to STALE, never EMPTY: an expired entry beats a thrown error.
      const stale = store.get(key);
      if (stale) return stale.v as T;
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
