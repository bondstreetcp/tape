/**
 * Pick the analyst actions a DAILY brief should talk about.
 *
 * WHY THIS IS A MODULE AND NOT FOUR LINES IN THE SCRIPT: the four lines were wrong for months and
 * nothing caught it. refresh-desk-note filtered to `up || down` and took `.slice(0, 12)`. Genuine
 * rating changes are RARE — the overwhelming majority of analyst activity is maintains, reiterations
 * and initiations — so the slice reached back as far as it needed to find twelve of them, and the desk
 * published week-old downgrades under a "Daily Desk" heading.
 *
 * Measured on sp500, 2026-07-27: that day carried 17 analyst actions and ZERO up/down. The cumulative
 * up/down count did not reach 12 until 2026-07-21. So the brief showed SIX-DAY-OLD downgrades while
 * discarding all 17 of the day's real notes, and the model narrated them as today's news.
 *
 * THE RULE: a count-bounded slice over a filtered list is never "the N most recent" — it is "however
 * far back I had to go to find N". Bound the WINDOW and let the count float. Same trap as the
 * move-attribution incident, where `.slice(0,N)` on a source-ranked list was read as "N newest".
 */

export interface DeskAction {
  symbol: string;
  firm: string;
  action: string; // up | down | main | init | reit
  fromGrade: string;
  toGrade: string;
  targetTo: number | null;
  date: string; // bare YYYY-MM-DD calendar square
}

/** A rating CHANGE — the high-signal events, and the rare ones. */
export const isRatingChange = (a: Pick<DeskAction, "action">): boolean =>
  a.action === "up" || a.action === "down" || a.action === "init";

/** Rank within a single day: a change outranks an initiation outranks a reiterate/maintain. */
export const signalTier = (a: Pick<DeskAction, "action">): number =>
  a.action === "up" || a.action === "down" ? 0 : a.action === "init" ? 1 : 2;

export const actionVerb = (a: Pick<DeskAction, "action" | "fromGrade" | "toGrade">): string =>
  a.action === "up" ? `UPGRADE ${a.fromGrade || "?"}→${a.toGrade || "?"}`
  : a.action === "down" ? `DOWNGRADE ${a.fromGrade || "?"}→${a.toGrade || "?"}`
  : a.action === "init" ? `INITIATED at ${a.toGrade || "?"}`
  : a.action === "reit" ? `REITERATED ${a.toGrade || "?"}`
  : `MAINTAINED ${a.toGrade || "?"}`;

export interface SelectOpts {
  /** Age bound in CALENDAR days. 4 by default so Monday's desk still sees Friday's tape. */
  windowDays?: number;
  /** Total bullets. */
  max?: number;
  /** Slots reserved for rating changes so a busy day of maintains can't crowd them out. */
  reserveChanges?: number;
}

/**
 * @param ageDays  age of a bare YYYY-MM-DD in CALENDAR days — inject it so the caller uses the
 *                 codebase's calendar helper (`daysUntil`) rather than an elapsed-ms subtraction,
 *                 which makes the window flip with the clock.
 *
 * Returns newest-first: this is a daily brief, so today's tape leads and Thursday's upgrade follows.
 */
export function selectDeskActions<T extends DeskAction>(
  all: T[],
  ageDays: (iso: string) => number,
  opts: SelectOpts = {},
): T[] {
  const { windowDays = 4, max = 12, reserveChanges = 6 } = opts;
  const inWindow = all.filter((a) => ageDays(a.date) <= windowDays);
  // Newest first, then by signal within a day.
  const byRecency = (x: T, y: T) => y.date.localeCompare(x.date) || signalTier(x) - signalTier(y);

  // Two buckets, because the failure modes pull opposite ways. Changes are rare and must never be
  // crowded out. Maintains/reiterations are plentiful and only earn a slot if they carry a price
  // target — without one they say nothing at all.
  const changes = inWindow.filter(isRatingChange).sort(byRecency).slice(0, reserveChanges);
  const withTarget = inWindow.filter((a) => !isRatingChange(a) && a.targetTo != null).sort(byRecency);

  const picked: T[] = [...changes];
  for (const a of withTarget) {
    if (picked.length >= max) break;
    picked.push(a);
  }
  return picked.sort(byRecency);
}
