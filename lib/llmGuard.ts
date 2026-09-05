/**
 * The gate on every LLM-backed API route. The site is deliberately open during the beta
 * (docs/SETUP-auth.md), so a visitor — or a crawler — can call any route that spends OpenRouter or Gemini
 * credit. Two things stand between that and the bill:
 *
 *  1. RATE LIMITS (here): a token bucket per client IP and one global bucket, both generous for a human
 *     (a burst of 40, then 10 a minute per IP; 200 then 40 a minute overall) and hopeless for a script.
 *     A refused call gets a 429 with Retry-After. Buckets live in process memory — one process on the
 *     NAS slot, per-instance on Vercel, which is fine for a ceiling.
 *  2. A DAILY SPEND CEILING (lib/llmUsage.webSpendCapped, enforced inside lib/llm): once the web process
 *     has spent LLM_WEB_DAILY_CAP_USD (default $5) today, live model calls decline and each route falls
 *     to its own "couldn't generate" path — cached answers keep serving.
 *
 * Call at the top of a handler: `const limited = guardLlmRoute(req); if (limited) return limited;`
 * Knobs: LLM_ROUTE_IP_BURST / LLM_ROUTE_IP_PER_MIN / LLM_ROUTE_GLOBAL_BURST / LLM_ROUTE_GLOBAL_PER_MIN.
 */
import { NextResponse } from "next/server";
import { BucketRegistry, clientKey } from "./apiLimit";

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; };
const PER_IP = new BucketRegistry({ capacity: num(process.env.LLM_ROUTE_IP_BURST, 40), refillPerSec: num(process.env.LLM_ROUTE_IP_PER_MIN, 10) / 60 });
const GLOBAL = new BucketRegistry({ capacity: num(process.env.LLM_ROUTE_GLOBAL_BURST, 200), refillPerSec: num(process.env.LLM_ROUTE_GLOBAL_PER_MIN, 40) / 60 });

/** null = proceed; otherwise the 429 response to return as-is. */
export function guardLlmRoute(req: { headers: { get(name: string): string | null } }): NextResponse | null {
  const ip = clientKey(req.headers);
  const g = GLOBAL.take("all");
  const p = PER_IP.take(ip);
  if (g.ok && p.ok) return null;
  const retry = Math.max(g.retryAfterSec, p.retryAfterSec, 1);
  return NextResponse.json(
    { error: `Too many AI requests — try again in ${retry}s.`, retryAfterSec: retry },
    { status: 429, headers: { "Retry-After": String(retry), "Cache-Control": "no-store" } },
  );
}
