/**
 * Calendar-date arithmetic.
 *
 * The distinction this module exists to enforce: a bare YYYY-MM-DD is a CALENDAR SQUARE, not an
 * instant. Diffing one against `Date.now()` silently mixes the two, and the answer then depends on
 * what time of day you asked — on a Wednesday at 11am ET, a Friday expiry rounds to "1d" instead of
 * 2, so every DTE on the site reads one short for the whole US session. Run the same code at 02:00
 * UTC (when the nightly fires) and it's right, which is exactly why it survived: it's correct when
 * the pipeline asks and wrong when a human does.
 *
 * lib/format's fmtDate enforces the same calendar-vs-instant distinction for RENDERING; this is the
 * arithmetic half. If you're reaching for `Date.now()` next to a YYYY-MM-DD, you want this instead.
 */

const DAY = 86_400_000;

/** Floor an instant to UTC midnight of the calendar day it falls in. */
export const utcMidnight = (ms: number) => Math.floor(ms / DAY) * DAY;

/**
 * Whole calendar days from today until `day` (a bare YYYY-MM-DD). Negative = in the past, 0 = today.
 *
 * Both legs land on UTC midnight, so the difference is an EXACT multiple of 86.4M ms — the result is
 * a true integer rather than a rounded guess, and it cannot drift with the clock. (UTC has no DST,
 * so there are no 23- or 25-hour days to spoil that.) Returns null for anything unparseable.
 */
export function daysUntil(day: string, nowMs: number = Date.now()): number | null {
  if (!day) return null;
  const t = Date.parse(/^\d{4}-\d{2}-\d{2}$/.test(day) ? day + "T00:00:00Z" : day);
  if (!Number.isFinite(t)) return null;
  return Math.round((utcMidnight(t) - utcMidnight(nowMs)) / DAY);
}
