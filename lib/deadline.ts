/**
 * The timeout primitive the vendor-fetch layer never had.
 *
 * `export const maxDuration` is a VERCEL directive. Under `next start` on the NAS it enforces
 * NOTHING, so for months the only real bound on a live vendor call was undici's ~300s headers
 * timeout — and a response that trickles resets the body timeout on every chunk, so a slow endpoint
 * can hang effectively forever. Meanwhile Cloudflare 524s the viewer at ~100s WITHOUT cancelling the
 * origin work: the request is dead to the user while the NAS keeps grinding and the vendor quota is
 * spent on a response nobody will read.
 *
 * The pattern already existed where a hang had actually been observed (borrow 12s, stocktwits 12/16s,
 * riskFactors 15s, fred 20s, secFrames 30s) — it was simply never applied at the two highest fan-in
 * points, lib/edgar and lib/yahooClient, which between them feed ~25 modules.
 *
 * Two tools, because there are two shapes of call:
 *   - deadline(ms)  → an AbortSignal for anything that takes one (raw fetch).
 *   - withDeadline() → a wall-clock race for SDK calls that accept no signal (yahoo-finance2).
 *     A race can't cancel the underlying socket, but it DOES bound what the caller waits for, which
 *     is what turns "the page hangs" into "the card degrades".
 */

/** Default ceiling for one live vendor request. Generous enough for a cold SEC/Yahoo response,
 *  far below the ~100s at which Cloudflare gives up on the user's behalf. */
export const VENDOR_TIMEOUT_MS = 20_000;

/** Total budget across a retry loop. Without this a 5-attempt loop with backoff could run minutes. */
export const VENDOR_BUDGET_MS = 45_000;

/** An AbortSignal that fires after `ms`. Thin wrapper so every call site reads identically and the
 *  default lives in one place. */
export const deadline = (ms: number = VENDOR_TIMEOUT_MS): AbortSignal => AbortSignal.timeout(ms);

/** Error thrown when `withDeadline` gives up. Named so callers can classify it (e.g. lib/yahooClient
 *  treats it as non-recoverable — a fresh cookie cannot cure an endpoint that isn't answering). */
export class DeadlineError extends Error {
  readonly timeout = true;
  constructor(label: string, ms: number) {
    super(`${label} exceeded ${ms}ms`);
    this.name = "DeadlineError";
  }
}

/** True for anything this module (or AbortSignal.timeout) raised as a timeout. */
export const isDeadline = (e: unknown): boolean =>
  !!e && ((e as any).timeout === true || (e as any).name === "DeadlineError" || (e as any).name === "TimeoutError");

/**
 * Bound a promise that cannot take an AbortSignal. Rejects with DeadlineError past `ms`.
 *
 * NOTE the underlying work keeps running — this bounds the WAIT, not the socket. That is the correct
 * trade here: the alternative is a request that never returns at all.
 */
export function withDeadline<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new DeadlineError(label, ms)), ms);
    p.then(
      (v) => { clearTimeout(t); resolve(v); },
      (e) => { clearTimeout(t); reject(e); },
    );
  });
}
