/**
 * Token-bucket rate limiting for the LLM-backed API routes — the site is deliberately open during the beta
 * (docs/SETUP-auth.md), so anyone can call a route that spends OpenRouter/Gemini credit. Two buckets gate
 * every such call: one per client IP (a visitor, or a bot) and one global (a distributed crawler), and a
 * daily spend ceiling for the web process sits behind both (lib/llmGuard). Pure bucket math here, tested;
 * the buckets live in process memory, which is exactly one process on the NAS slot.
 */

export interface Bucket { tokens: number; updatedAt: number }
export interface BucketSpec { capacity: number; refillPerSec: number }

/**
 * Take one token from the bucket if it has one. Returns whether the call may proceed and, when it may not,
 * how many whole seconds until the next token. Refill is continuous (capacity-capped), so a burst of
 * `capacity` calls is allowed and the sustained rate is `refillPerSec`.
 */
export function takeToken(b: Bucket | undefined, spec: BucketSpec, now: number): { ok: boolean; bucket: Bucket; retryAfterSec: number } {
  const prev = b ?? { tokens: spec.capacity, updatedAt: now };
  const elapsed = Math.max(0, (now - prev.updatedAt) / 1000);
  const tokens = Math.min(spec.capacity, prev.tokens + elapsed * spec.refillPerSec);
  if (tokens >= 1) return { ok: true, bucket: { tokens: tokens - 1, updatedAt: now }, retryAfterSec: 0 };
  const deficit = 1 - tokens;
  return { ok: false, bucket: { tokens, updatedAt: now }, retryAfterSec: Math.max(1, Math.ceil(deficit / spec.refillPerSec)) };
}

/** A registry of named buckets (per IP, plus one global), pruned so idle IPs don't accumulate forever. */
export class BucketRegistry {
  private buckets = new Map<string, Bucket>();
  constructor(private spec: BucketSpec, private maxEntries = 5000) {}
  take(key: string, now = Date.now()): { ok: boolean; retryAfterSec: number } {
    const r = takeToken(this.buckets.get(key), this.spec, now);
    this.buckets.set(key, r.bucket);
    if (this.buckets.size > this.maxEntries) this.prune(now);
    return { ok: r.ok, retryAfterSec: r.retryAfterSec };
  }
  /** Drop buckets that have fully refilled (they're indistinguishable from absent). */
  prune(now = Date.now()): void {
    for (const [k, b] of this.buckets) {
      const full = Math.min(this.spec.capacity, b.tokens + Math.max(0, (now - b.updatedAt) / 1000) * this.spec.refillPerSec) >= this.spec.capacity;
      if (full) this.buckets.delete(k);
    }
  }
  get size(): number { return this.buckets.size; }
}

/** The client's address as the CDN/tunnel reports it — Cloudflare's header first, then the proxy chain's first hop. */
export function clientKey(headers: { get(name: string): string | null }): string {
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const xff = headers.get("x-forwarded-for");
  if (xff) return xff.split(",")[0].trim() || "unknown";
  return headers.get("x-real-ip")?.trim() || "local";
}
