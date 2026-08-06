/**
 * Government-contract award monitor — types + pure momentum math for /gov-contracts.
 *
 * THE EDGE: federal contract obligations are a hard, public, forward-looking read on a government-
 * exposed company's revenue — a backlog momentum signal months ahead of the earnings that report it,
 * and one no equity screener surfaces. Source is USAspending.gov (public domain, KEYLESS — verified
 * live). The one hard part is recipient-name → ticker, so we DON'T fuzzy-match: the roster is a
 * curated, individually-verified map of government-exposed public companies to their USAspending
 * recipient search name (the same verified-map-not-heuristic doctrine as the share-class fixups and
 * the super-investor CIKs). A name that stops returning awards degrades to a zero row, never a wrong
 * one.
 *
 * Pure (no fs/fetch) so the momentum math is unit-testable; the nightly fetch lives in
 * scripts/refresh-gov-contracts.ts.
 */

export interface GovAgency {
  name: string;
  amount: number;
}

export interface GovContractRow {
  ticker: string;
  name: string;
  /** obligations in the trailing 4 fiscal quarters, USD */
  ttmObligated: number;
  /** obligations in the 4 quarters BEFORE that — the YoY base */
  priorObligated: number;
  /** (ttm − prior) / prior, null when there's no prior base to grow from */
  yoyPct: number | null;
  latestQuarter: string; // "FY26 Q3"
  latestQuarterAmount: number;
  topAgencies: GovAgency[]; // up to 3, largest first, over the trailing window
  quarters: { q: string; amount: number; partial: boolean }[]; // ~8 quarters oldest→newest, for the sparkline
}

export interface GovContractsFile {
  generatedAt: string;
  rows: GovContractRow[];
  rosterSize: number; // how many roster names were queried (so a shrink is visible)
}

export interface QuarterPoint {
  fiscal_year: number;
  quarter: number;
  amount: number;
}

export const qLabel = (p: { fiscal_year: number; quarter: number }): string => `FY${String(p.fiscal_year).slice(2)} Q${p.quarter}`;

/**
 * End of a FEDERAL fiscal quarter, in ms. FY N runs Oct 1 (N−1) → Sep 30 (N): Q1 ends Dec 31 (N−1),
 * Q2 Mar 31 (N), Q3 Jun 30 (N), Q4 Sep 30 (N). Bare-date construction (UTC) — a fiscal quarter end
 * is a calendar square, not an instant.
 */
export function fiscalQuarterEndMs(fy: number, q: number): number {
  const ends: Record<number, [number, number, number]> = {
    1: [fy - 1, 11, 31], 2: [fy, 2, 31], 3: [fy, 5, 30], 4: [fy, 8, 30],
  };
  const [y, m, d] = ends[q] ?? [fy, 8, 30];
  return Date.UTC(y, m, d);
}

/**
 * A quarter is COMPLETE for momentum only once it has ended AND the federal reporting lag has passed.
 * USAspending trails real obligations by ~weeks, and the current fiscal quarter is partial by
 * definition — including either makes every TTM look shrunken (observed live: LMT −49.7% purely
 * because FY26 Q4 was 1/3 elapsed). LAG_DAYS keeps a just-closed-but-still-filling quarter out.
 */
export const REPORTING_LAG_DAYS = 30; // FPDS obligations are mostly reported within a month; 30d keeps the latest just-closed quarter usable without pulling in a still-filling one
export function isCompleteQuarter(fy: number, q: number, nowMs: number): boolean {
  return nowMs >= fiscalQuarterEndMs(fy, q) + REPORTING_LAG_DAYS * 86_400_000;
}

/** Below this trailing base, a YoY % is noise (a near-zero prior turns a normal quarter into a
 *  million-percent "riser" — observed live: Cencora at +2,774,987%). */
export const MIN_YOY_BASE_USD = 25_000_000;

/**
 * Momentum from a recipient's quarterly obligations. Compares the last 4 COMPLETE quarters vs the 4
 * before them; the incomplete current quarter is excluded from the comparison but kept in `quarters`
 * for the sparkline (flagged partial). yoy is null when there's no ≥MIN_YOY_BASE prior to grow from —
 * never a fabricated giant number.
 */
export function momentumFrom(points: QuarterPoint[], nowMs: number): {
  ttmObligated: number;
  priorObligated: number;
  yoyPct: number | null;
  latestQuarter: string;
  latestQuarterAmount: number;
  quarters: { q: string; amount: number; partial: boolean }[];
} {
  const sorted = [...points].sort((a, b) => a.fiscal_year - b.fiscal_year || a.quarter - b.quarter);
  const complete = sorted.filter((p) => isCompleteQuarter(p.fiscal_year, p.quarter, nowMs));
  const sum = (xs: QuarterPoint[]) => xs.reduce((a, b) => a + (b.amount || 0), 0);
  const ttm = sum(complete.slice(-4));
  const prior = sum(complete.slice(-8, -4));
  const latest = complete[complete.length - 1];
  return {
    ttmObligated: Math.round(ttm),
    priorObligated: Math.round(prior),
    yoyPct: prior >= MIN_YOY_BASE_USD ? +(((ttm - prior) / prior) * 100).toFixed(1) : null,
    latestQuarter: latest ? qLabel(latest) : "",
    latestQuarterAmount: latest ? Math.round(latest.amount || 0) : 0,
    quarters: sorted.slice(-8).map((p) => ({ q: qLabel(p), amount: Math.round(p.amount || 0), partial: !isCompleteQuarter(p.fiscal_year, p.quarter, nowMs) })),
  };
}
