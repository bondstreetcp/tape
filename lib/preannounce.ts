/**
 * Preannouncement detector — did this company file an 8-K Item 2.02 (Results of Operations) AHEAD of
 * its scheduled print? If so, the scheduled print is no longer the event the options history graded:
 * the market has already repriced on the prelim numbers, IV for the print is bid because a known
 * release is live, and BOTH sides of the rich/cheap-vs-history read are contaminated (the history
 * measured normal full-information prints). The IBM 2026-08 report is the canonical case: it
 * preannounced, the stock blew up on that, and the print straddle screened "expensive vs history"
 * for the known-event reason, not a mispricing.
 *
 * Detection is CODE against the SEC submissions JSON (form + items + filingDate — no LLM): an 8-K
 * whose items include 2.02, filed 2–35 days before the scheduled earnings date. ≥2d excludes the
 * release itself (and timing noise around it); ≤35d excludes the PRIOR quarter's earnings 8-K
 * (~90d back). Fires as a CatalystFlag kind "preannounce", which tradeIdea treats like an
 * acquisition: no play, both directions (see lib/earningsTrade).
 *
 * Server-only (network). Best-effort: any failure returns null — never blocks the card.
 */
import { tickerToCik, getSubmissions } from "@/lib/edgar";
import type { CatalystFlag } from "@/lib/catalystOverlay";

const DAY = 86_400_000;

/** Calendar-square day difference: earnings day minus filing day, both YYYY-MM-DD (UTC squares). */
export function daysBefore(filedDay: string, earningsDay: string): number | null {
  const f = Date.parse(filedDay);
  const e = Date.parse(earningsDay);
  if (!Number.isFinite(f) || !Number.isFinite(e)) return null;
  return Math.round((e - f) / DAY);
}

/** Pure classifier — is this filing a preannouncement relative to the scheduled print? */
export function isPreannouncement8K(form: string, items: string | undefined, filedDay: string, earningsDay: string): boolean {
  if (!/^8-K(\/A)?$/.test(form)) return false;
  if (!items || !items.split(",").some((s) => s.trim() === "2.02")) return false;
  const d = daysBefore(filedDay, earningsDay);
  return d != null && d >= 2 && d <= 35;
}

// Per-process memo (sym+earnings day → flag or null) — the live card re-renders; the submissions
// fetch should happen once per name per process, not per view.
const memo = new Map<string, CatalystFlag | null>();

export async function detectPreannounce(sym: string, earningsISO: string | null): Promise<CatalystFlag | null> {
  if (!earningsISO) return null;
  const earningsDay = earningsISO.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(earningsDay)) return null;
  const key = `${sym.toUpperCase()}|${earningsDay}`;
  if (memo.has(key)) return memo.get(key)!;
  let flag: CatalystFlag | null = null;
  try {
    // Internally time-bound so EVERY caller (the live card's hot path, the nightly logger) is
    // protected — a slow SEC day degrades to "no flag", never to a hung card.
    const bounded = <T>(p: Promise<T>): Promise<T | null> =>
      Promise.race([p, new Promise<null>((r) => setTimeout(() => r(null), 6_000))]);
    const cik = await bounded(tickerToCik(sym));
    if (cik) {
      const recent = (await bounded(getSubmissions(cik)))?.filings?.recent;
      const forms: string[] = recent?.form ?? [];
      const dates: string[] = recent?.filingDate ?? [];
      const items: string[] = recent?.items ?? [];
      // Newest-first; anything filed >40d before the print can't qualify and nothing older can either.
      for (let i = 0; i < forms.length; i++) {
        const db = daysBefore(dates[i], earningsDay);
        if (db != null && db > 40) break;
        if (isPreannouncement8K(forms[i], items[i], dates[i], earningsDay)) {
          flag = {
            kind: "preannounce",
            headline: `8-K Item 2.02 (prelim results) filed ${dates[i]}, ${db}d ahead of the scheduled print`,
            date: dates[i],
          };
          break;
        }
      }
    }
  } catch { /* submissions unreachable — no flag */ }
  memo.set(key, flag);
  return flag;
}
