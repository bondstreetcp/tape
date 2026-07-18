/**
 * Shared, SELF-HEALING yahoo-finance2 client. Every live-Yahoo lib module routes through this ONE
 * instance instead of holding its own `new YahooFinance()`.
 *
 * WHY: yahoo-finance2 caches Yahoo's cookie + crumb ON the client instance. On a long-running
 * SINGLE-process origin — the self-hosted NAS serves the app from one `next start` for hours — a
 * crumb that goes stale then fails EVERY subsequent call until the process restarts, so the live
 * per-stock tabs (Earnings, Overview, Ratings, live Options…) come up empty. Vercel never hits this
 * (a fresh serverless process per invocation re-bootstraps the crumb) and neither does local dev.
 *
 * THE FIX: on any failure, retry ONCE on a fresh instance and, if that succeeds, ADOPT it as the new
 * shared client so the whole module tree self-heals — not just the one call. Every failure is logged
 * with the real reason (a silent `catch { return null }` hid whether it was a recoverable stale crumb
 * or a hard IP block / rate-limit, which need a proxy or a nightly bake instead).
 */
import YahooFinance from "yahoo-finance2";

type YF = InstanceType<typeof YahooFinance>; // the default export is the CLASS (a value) — index its instance

const OPTS = { suppressNotices: ["yahooSurvey"] } as const;
const make = () => new YahooFinance(OPTS as any);
let shared = make();

/**
 * Pure retry-then-heal core (client-agnostic, unit-tested). Run `fn(primary)`; on throw, retry once
 * on a fresh client and — only if the retry SUCCEEDS — call `onHeal(fresh)` so callers can adopt it.
 * `log` fires on the retry attempt and again if the retry also fails; the second error is rethrown so
 * the caller's own fallback (usually `.catch(() => null)`) still runs, but the reason is now visible.
 */
export async function callWithHeal<C, T>(
  primary: C,
  makeFresh: () => C,
  fn: (c: C) => Promise<T>,
  onHeal: (c: C) => void,
  log: (stage: "skip" | "retry" | "fail", err: unknown) => void,
  shouldRetry: (err: unknown) => boolean = () => true,
): Promise<T> {
  try {
    return await fn(primary);
  } catch (e1) {
    // A fresh crumb won't cure a rate-limit / forbidden / no-such-symbol — retrying just fires a
    // second request (plus a cookie bootstrap) at an endpoint already refusing us. Bail out fast and
    // let the caller's own fallback run; the reason is still logged.
    if (!shouldRetry(e1)) { log("skip", e1); throw e1; }
    log("retry", e1);
    const fresh = makeFresh();
    try {
      const r = await fn(fresh);
      onHeal(fresh);
      return r;
    } catch (e2) {
      log("fail", e2);
      throw e2;
    }
  }
}

/** yahoo-finance2 puts the HTTP status on `err.code`; keep it in the log so a NAS operator can tell a
 *  recoverable stale crumb (401 / "invalid crumb") from a hard block (429 / 403) at a glance. */
const detail = (e: unknown) => `${(e as any)?.code != null ? `[${(e as any).code}] ` : ""}${String((e as any)?.message || e).slice(0, 180)}`;

/** Retry ONLY recoverable failures: a stale crumb/cookie (401, "invalid crumb"), a transient network
 *  blip ("fetch failed", timeouts, socket hangups) or a 5xx. A 429/403 (rate-limit/block) or a
 *  404/"no data" (definitive) is NOT worth a fresh-crumb retry. Exported for the unit test. */
export function recoverable(e: unknown): boolean {
  const code = (e as any)?.code;
  if (code === 429 || code === 403 || code === 404) return false;
  return !/not found|no data|invalid.*(symbol|ticker)/i.test(String((e as any)?.message || e));
}

const STAGE: Record<"skip" | "retry" | "fail", string> = {
  skip: "not retried — looks like a hard block / no-data",
  retry: "first attempt failed — retrying on a fresh client",
  fail: "failed after fresh-client retry",
};

function heal<T>(op: string, symbol: unknown, fn: (c: YF) => Promise<T>): Promise<T> {
  return callWithHeal(
    shared,
    make,
    fn,
    (c) => { shared = c; },
    (stage, err) => console.warn(`yahoo ${op} ${String(symbol)}: ${STAGE[stage]} — ${detail(err)}`),
    recoverable,
  );
}

/** Drop-in replacement for a per-module `new YahooFinance()` — identical method signatures (the casts
 *  hand callers the real yahoo-finance2 types), but every call is self-healing + logged. Only the five
 *  methods the app actually uses are exposed; add more here if a caller needs one. */
export const yahoo = {
  quoteSummary: ((...a: any[]) => heal("quoteSummary", a[0], (c) => (c as any).quoteSummary(...a))) as OmitThisParameter<YF["quoteSummary"]>,
  chart: ((...a: any[]) => heal("chart", a[0], (c) => (c as any).chart(...a))) as OmitThisParameter<YF["chart"]>,
  quote: ((...a: any[]) => heal("quote", a[0], (c) => (c as any).quote(...a))) as OmitThisParameter<YF["quote"]>,
  fundamentalsTimeSeries: ((...a: any[]) => heal("fundamentalsTimeSeries", a[0], (c) => (c as any).fundamentalsTimeSeries(...a))) as OmitThisParameter<YF["fundamentalsTimeSeries"]>,
  options: ((...a: any[]) => heal("options", a[0], (c) => (c as any).options(...a))) as OmitThisParameter<YF["options"]>,
};
