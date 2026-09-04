/**
 * The per-name INCREMENTAL GATE shared by the filing-driven extractors (same-store sales, guidance): each
 * name stores the accession of the newest earnings release it has processed, and a nightly run skips the
 * name while the newest release on EDGAR still matches it.
 *
 * The gate may only ADVANCE once the newest release was actually READ and EXTRACTED. A transient failure
 * (EDGAR outage or rate-limit, empty filing text, an LLM 402/timeout) used to stamp the new accession
 * anyway, which skipped that quarter FOREVER — the comp series silently lost a print until a manual
 * BACKFILL, and the guidance extractor once stored guides:[] and advanced, erasing a standing guide until
 * the next print. A failure now leaves the gate where it was, so the next run simply retries.
 *
 * Pure; tests in tests/incrementalGate.test.ts.
 */
export function advanceGate(newestAcc: string, newestProcessed: boolean, priorAcc: string | undefined): string {
  return newestProcessed ? newestAcc : priorAcc ?? "";
}
