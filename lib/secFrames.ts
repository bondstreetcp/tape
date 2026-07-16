/**
 * SEC XBRL "frames" — the cross-sectional API — used here as a FILING DETECTOR.
 *
 * One frame request returns one concept for EVERY filer at once (e.g. Assets as of CY2026Q1I ≈
 * 5,400 entities, ~700 KB). We fetch a handful of broad INSTANT frames and reduce them to
 * "the newest period-end each CIK has filed". A per-name refresher then pulls the full 3.75 MB
 * companyfacts ONLY for names that actually filed something new — turning "re-pull everything
 * older than N days" (hundreds of pulls/night, ~GBs) into "pull the ~dozen names that filed
 * yesterday". On the NAS's slow SEC path (~4.2s/request measured 2026-07-16) that's the
 * difference between a step that dies and one that finishes in minutes.
 *
 * ⚠ WHY frames can't replace companyfacts as the SOURCE (measured, don't re-litigate):
 * quarterly DURATION frames only contain facts whose reported span is ~91 days. Cash-flow
 * statements in 10-Qs carry ONLY year-to-date columns, so a "Q2 repurchase" fact doesn't exist
 * for calendar-FY filers — CY2025Q2 for PaymentsForRepurchaseOfCommonStock has ~130 entities vs
 * Q1's ~1,600 (the 130 are off-calendar fiscal years whose Q1 lands there). SEC does NOT compute
 * the differences. So exact TTMs still need companyfacts + YTD de-cumulation; frames just tells
 * us WHEN to bother. (Income-statement quarterlies DO exist — 3-month columns are tagged — and
 * instant/annual frames are rich; only cash-flow quarterlies are a mirage.)
 *
 * Server-only (fetches SEC).
 */

const UA = "stock-chart-screener (research; jameslyeh@gmail.com)"; // SEC 403s UA's without a contact
const DAY = 86_400_000;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Canonical CIK key — frames carry numbers, tickerToCik strings (sometimes zero-padded). */
export const cikKey = (cik: string | number): string => String(Number(String(cik).replace(/\D/g, "")));

/**
 * The instant-frame ids worth scanning "now": the CURRENT calendar quarter's I-frame (it exists
 * early and GROWS live as filings land — CY2026Q2I already had 626 entities by mid-July 2026)
 * plus the prior `n-1`, so off-calendar fiscal ends are covered. Pure — exported for tests.
 */
export function instantFrameIds(nowMs: number, n = 3): string[] {
  const d = new Date(nowMs);
  let y = d.getUTCFullYear();
  let q = Math.floor(d.getUTCMonth() / 3) + 1; // 1..4
  const out: string[] = [];
  for (let i = 0; i < n; i++) {
    out.push(`CY${y}Q${q}I`);
    q--;
    if (q === 0) { q = 4; y--; }
  }
  return out;
}

async function frameFetch(url: string): Promise<any | null> {
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { "User-Agent": UA }, cache: "no-store", signal: AbortSignal.timeout(30_000) });
      if (r.status === 404) return null; // frame doesn't exist (too early / bad concept) — not an error
      if (r.ok) {
        // A truncated/reset body on a 200 is a FAILURE to retry — NOT the 404 "legitimately absent"
        // sentinel. Conflating them classified the most common slow-path failure (connection reset
        // mid-body) as "nobody filed", silently poisoning the detector map. (Review finding.)
        const j = await r.json().catch(() => undefined);
        if (j !== undefined) return j;
      }
      // 429/403/5xx or corrupt body → back off and retry
    } catch { /* retry */ }
    await sleep(700 * (i + 1));
  }
  return undefined; // undefined = FAILED (vs null = legitimately absent) — callers count failures
}

// us-gaap/Assets ONLY — deliberately not unioned with dei shares-outstanding. Every balance sheet
// tags Assets (CY2026Q1I ≈ 5,431 entities), and — the load-bearing property — its period-ends are
// BALANCE-SHEET dates, the same ends a companyfacts pull sees for the same concept. A dei
// cover-page instant is dated weeks AFTER quarter-end, so mixing it in would leave frameEnd
// permanently ahead of any seenEnd a puller can stamp → those names re-pull every night forever.
// Detector and stamper reading the SAME concept makes the idempotency loop close by construction.
// (IFRS-only filers don't tag us-gaap Assets → invisible → the blanket-age fallback covers them.)
const DETECTOR_FRAMES: { taxonomy: string; concept: string; unit: string }[] = [
  { taxonomy: "us-gaap", concept: "Assets", unit: "USD" },
];

/** Newest us-gaap/Assets instant end in a companyfacts JSON — the stamp that pairs with the
 *  detector. Both read the same concept, so `frameEnd ≤ seenEnd` becomes provable after a pull. */
export function seenEndFromFacts(companyfactsJson: any): string | null {
  const arr = companyfactsJson?.facts?.["us-gaap"]?.Assets?.units?.USD;
  let max: string | null = null;
  if (Array.isArray(arr)) for (const f of arr) if (f?.end && (!max || f.end > max)) max = f.end;
  return max;
}

/**
 * "What is the newest period-end each CIK has FILED?" — Map<cikKey, YYYY-MM-DD>, from the union
 * of the last `quarters` instant frames × the detector concepts (≈6 requests, ~3 MB total).
 *
 * Returns NULL when every request failed (SEC unreachable / throttled) — callers MUST treat that
 * as "detector down → fall back to age-based staleness", never as "nothing filed" (which would
 * silently freeze a feed forever).
 */
export async function latestFilingEnds(nowMs: number = Date.now(), quarters = 4): Promise<Map<string, string> | null> {
  const out = new Map<string, string>();
  let okFrames = 0, failed = 0;
  for (const id of instantFrameIds(nowMs, quarters)) {
    for (const f of DETECTOR_FRAMES) {
      const j = await frameFetch(`https://data.sec.gov/api/xbrl/frames/${f.taxonomy}/${f.concept}/${f.unit}/${id}.json`);
      if (j === undefined) { failed++; continue; }
      if (!j?.data?.length) continue;
      okFrames++;
      for (const row of j.data) {
        if (!row?.cik || !row?.end) continue;
        const k = cikKey(row.cik);
        const prev = out.get(k);
        if (!prev || row.end > prev) out.set(k, row.end);
      }
    }
  }
  // ANY failed frame invalidates the whole map — a partial map is worse than no map. If the newest
  // quarter's frame failed while older ones loaded, every recent filer would read "frameEnd = last
  // quarter" ⇒ frameEnd ≤ seenEnd ⇒ NOT due — routing exactly the names that just filed to the
  // 30-day restatement ceiling instead of the 7-day blanket rule the fallback contract promises.
  // One degraded night at blanket-rule cost is cheap; a silently poisoned detector is not.
  if (failed > 0) {
    console.warn(`secFrames: ${failed} detector frame(s) failed (${okFrames} ok) — discarding the partial map; callers fall back to age-based staleness`);
    return null;
  }
  return out;
}

/** The cache-entry fields the due-decision reads. Both feeds' caches satisfy this shape. */
export interface FiledCacheEntry {
  /** YYYY-MM-DD of the last per-name SEC pull. */
  fetchedAt?: string | null;
  /** Newest period-end SEEN in that pull — the idempotency key against the detector. */
  seenEnd?: string | null;
  /** Fallback baseline for pre-migration entries that predate seenEnd (e.g. the committed seed). */
  asOf?: string | null;
}

/** A name whose CIK never appears in the detector frames falls back to this blanket staleness. */
export const INVISIBLE_MAX_AGE_DAYS = 7;
/** Even a filing-quiet name is re-pulled this often — catches amendments/restatements that revise
 *  values without moving the period-end the detector watches. */
export const RESTATEMENT_CEILING_DAYS = 30;

const ageDays = (iso: string | null | undefined, nowMs: number): number =>
  iso ? Math.round((nowMs - Date.parse(iso + "T00:00:00Z")) / DAY) : Infinity;

/**
 * Should this name's full companyfacts be (re-)pulled tonight? PURE — the whole migration's
 * behavior hangs on this table, so it's tested case-by-case:
 *
 *   no cache entry                        → due (never seen)
 *   detector: frameEnd > seenEnd/asOf     → due (they FILED something we haven't ingested)
 *   detector: frameEnd ≤ baseline         → due only past the restatement ceiling (~monthly)
 *   entry has NO baseline at all          → due (can't prove freshness — self-heals: the pull stamps seenEnd)
 *   CIK invisible to the detector         → due past INVISIBLE_MAX_AGE_DAYS (the legacy blanket rule)
 */
export function isDueByFiling(entry: FiledCacheEntry | undefined, frameEnd: string | undefined, nowMs: number): boolean {
  if (!entry) return true;
  const baseline = entry.seenEnd ?? entry.asOf ?? null;
  if (frameEnd) {
    if (!baseline) return true;
    if (frameEnd > baseline) return true;
    return ageDays(entry.fetchedAt, nowMs) >= RESTATEMENT_CEILING_DAYS;
  }
  return ageDays(entry.fetchedAt, nowMs) >= INVISIBLE_MAX_AGE_DAYS;
}
