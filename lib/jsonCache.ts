/**
 * mtime-keyed file cache for the baked data/ feeds — read + parse ONCE, reuse until the file changes.
 *
 * lib/data.ts had no caching at all: every one of its ~47 importers re-read and re-JSON.parse'd the
 * feed on every request. The hot cases are brutal — /api/portfolio loops loadSnapshot over 5 US
 * universes (~7.8 MB of JSON) PER REQUEST, and /api/industry-intraday parses a universe snapshot on
 * every 40-60s poll tick from every open tab. A 3 MB parse is ~50-100ms of BLOCKING CPU: on the NAS
 * that stalls the single event loop for every concurrent viewer, and on serverless it is billed CPU
 * on every invocation (the Fluid-CPU cap that paused the Vercel project).
 *
 * Keyed on mtime+size rather than a TTL because the data is WRITTEN, not aged: the nightly hydrate
 * rewrites data/ and the very next call sees a new mtime and rebuilds. No staleness window, no clock
 * dependency (which this week proved is not something to lean on), and a `stat` is ~0.05ms against
 * the ~50-100ms it saves.
 *
 * Caches the BUILT value, not the raw text, so each loader's row→map transform is skipped too.
 * Bounded to MAX_ENTRIES; the intended key space is small (≈18 universe snapshots + a handful of
 * singleton feeds). Deliberately NOT used for the ~3,600 per-symbol series files — that key space is
 * unbounded and those files are individually small, so caching them would trade a real memory
 * problem for a marginal CPU win.
 */
import { promises as fs } from "fs";

/** A build that threw = "this feed isn't usable yet" (empty/malformed). Cached under the SAME stamp as
 *  a success so a broken feed costs one parse per rewrite instead of one per request — a rebuilt file
 *  gets a new stamp and is retried immediately. */
const NOT_BUILT = Symbol("not-built");

/** How long a previously-good parse may be carried forward over a file that currently won't parse.
 *
 *  The NAS refreshes data/ IN PLACE under a live server (tape-web-entrypoint.sh), so `tar` spends a
 *  moment writing each feed and a read landing in that window sees a truncated file. Returning null
 *  there is not a momentary blemish: an empty render gets pinned into Next's ISR route cache for the
 *  whole revalidate period, so ~10s of half-written file becomes ~10 min of an empty board. Carrying
 *  the last good value across the window is the same DEGRADE TO STALE, NEVER EMPTY rule the writers
 *  follow (lib/feedGuard), applied at the reader.
 *
 *  BOUNDED on purpose. An unbounded carry would serve a permanently corrupt feed forever and hide it
 *  from the freshness monitor — trading a visible outage for an invisible one, which is the trap this
 *  codebase keeps re-learning. After the window a broken feed reads as "not built" and surfaces. */
const STALE_CARRY_MS = 5 * 60_000;

interface Entry {
  mtimeMs: number;
  size: number;
  value: unknown | typeof NOT_BUILT;
  /** When the VALUE was produced — carried forward across a stamp change, so the carry window is
   *  measured from the last good parse rather than being renewed by each failed one. */
  at: number;
}

/** In-flight reads carry the stamp they STARTED from: a caller that has already observed a newer file
 *  must not be handed the older read's result, so joining is stamp-matched, not path-matched. */
interface Inflight {
  mtimeMs: number;
  size: number;
  p: Promise<unknown>;
}

const store = new Map<string, Entry>();
const inflight = new Map<string, Inflight>();
const MAX_ENTRIES = 64;

/**
 * Read `abs`, hand the raw text to `build`, and cache the result until the file's mtime/size change.
 * Returns null when the file is missing/unreadable or `build` throws (every caller here treats an
 * absent feed as "not built yet", never as an error).
 *
 * ⚠ THE RETURNED OBJECT IS SHARED. Callers used to get a private parse each; they now share one
 * instance, so mutating it in place would silently corrupt every other page. Treat it as frozen —
 * copy before sorting/reassigning. (Deep-freezing a 2,500-row snapshot would cost more than the parse
 * this saves, so the contract is enforced by convention and this comment.)
 */
export async function cachedFile<T>(abs: string, build: (raw: string) => T): Promise<T | null> {
  let stat: { mtimeMs: number; size: number };
  try {
    stat = await fs.stat(abs);
  } catch {
    store.delete(abs); // file vanished — don't keep serving a value for something that's gone
    return null;
  }
  const same = (a: { mtimeMs: number; size: number }) => a.mtimeMs === stat.mtimeMs && a.size === stat.size;

  const hit = store.get(abs);
  if (hit && same(hit)) return hit.value === NOT_BUILT ? null : (hit.value as T);

  // Share an in-flight read — but only one that started from the SAME file state. A caller that has
  // already seen a newer stamp must start its own read rather than inherit a superseded one.
  const running = inflight.get(abs);
  if (running && same(running)) return running.p as Promise<T | null>;

  const p = (async () => {
    let raw: string;
    try {
      raw = await fs.readFile(abs, "utf8");
    } catch {
      return null; // unreadable (vanished mid-flight, permissions) — "not built yet", as before
    }
    let value: unknown = NOT_BUILT;
    let at = Date.now();
    try {
      value = build(raw);
    } catch {
      // Malformed JSON, or a loader signalling "not built" by throwing. If we parsed this feed
      // successfully not long ago, keep serving THAT rather than an empty board — see STALE_CARRY_MS.
      // `at` is inherited, so the window runs from the last good parse and a feed that stays broken
      // eventually reads as "not built" instead of being masked indefinitely.
      if (hit && hit.value !== NOT_BUILT && Date.now() - hit.at < STALE_CARRY_MS) {
        value = hit.value;
        at = hit.at;
      } else {
        value = NOT_BUILT;
      }
    }
    // ⚠ Only cache when the file PROVABLY did not move under us. Adopting the post-read stat instead
    // (the original bug) keys bytes read at T1 by the file's state at T2, so a write landing inside
    // the parse window pins pre-write content under the post-write stamp — and because lookup is an
    // exact stamp match, that entry NEVER expires. Silent, permanent staleness, invisible to the
    // freshness monitor. If the file did move, we still return what we read (it was valid when read)
    // and simply leave the cache cold so the next call re-reads.
    const after = await fs.stat(abs).catch(() => null);
    if (after && same(after)) {
      store.set(abs, { mtimeMs: stat.mtimeMs, size: stat.size, value, at });
      if (store.size > MAX_ENTRIES) {
        const oldest = store.keys().next().value; // insertion order ≈ LRU enough for a fixed key space
        if (oldest !== undefined) store.delete(oldest);
      }
    }
    return value === NOT_BUILT ? null : value;
  })();
  // Clear only if still ours — a newer-stamp read may have replaced this entry while we were running.
  p.finally(() => { if (inflight.get(abs)?.p === p) inflight.delete(abs); });
  inflight.set(abs, { mtimeMs: stat.mtimeMs, size: stat.size, p });
  return p as Promise<T | null>;
}

/** Test/ops hook — drop everything (never used by app code). */
export function jsonCacheClear(): void {
  store.clear();
  inflight.clear();
}
