/**
 * Merger-arb — types + pure spread math for /merger-arb.
 *
 * A classic small-account edge: once a target signs a definitive merger agreement and files its
 * DEFM14A (the merger proxy headed to a shareholder vote), its stock trades a hair below the deal
 * price. The gap — the "spread" — is the annualized return for holding through the close, and the
 * risk is the deal breaking. Institutions crowd the big cash deals; the small and the messy ones are
 * exactly where a small account can operate.
 *
 * Doctrine: the LLM proposes the deal terms, CODE verifies — the cash price per share must appear
 * verbatim in the filing text (like /tenders) or the row is not shown. Pure (no fs/fetch) so the
 * spread math and the SPAC filter are unit-testable; the nightly build lives in
 * scripts/refresh-merger-arb.ts.
 */

export interface MergerArbRow {
  ticker: string;
  name: string;
  acquirer: string;
  /** cash / stock / mixed — spread math is only meaningful for cash (a fixed $ target). */
  consideration: "cash" | "stock" | "mixed";
  /** fixed cash price per target share (cash or the cash leg of mixed); null for pure stock. */
  cashPerShare: number | null;
  verified: boolean; // cashPerShare found verbatim in the filing text
  expectedClose: string | null; // YYYY-MM-DD if the filing states timing, else null
  filedAt: string; // DEFM14A filing date
  spot: number | null; // live quote
  /** (deal − spot) / spot, cash deals only */
  spreadPct: number | null;
  /** spread annualized by days-to-close (or a 120-day default when no date is stated) */
  annualizedPct: number | null;
  note: string | null; // one-line condition/status from the filing
  url: string;
}

/**
 * EVERY DEFM14A filer in the scan window — including the stock/mixed deals the cash board drops.
 * Filing a definitive merger proxy means the company is under a signed acquisition agreement
 * regardless of consideration, and that's the fact the earnings desk needs: an acquisition target's
 * stock is pinned to the deal, so its options no longer trade earnings (the KVUE long-straddle
 * report — a mixed K-C deal, invisible on the cash board, and the strategic-alt overlay had
 * deliberately dropped it as "resolved"). Consumed by lib/catalystOverlay as the "acquisition" flag.
 */
export interface DealTarget {
  ticker: string;
  name: string;
  filedAt: string; // DEFM14A filing date, YYYY-MM-DD
}

export interface MergerArbFile {
  generatedAt: string;
  rows: MergerArbRow[];
  scanned: number; // DEFM14A filings seen in the window
  spacs: number; // dropped as SPAC/blank-check deals
  /** all deal targets in the window, any consideration (cash rows are a subset) */
  targets?: DealTarget[];
}

/** Latest DEFM14A per ticker (a target can file amendments/supplements — keep the newest date). */
export function dedupeTargets(list: DealTarget[]): DealTarget[] {
  const by = new Map<string, DealTarget>();
  for (const t of list) {
    const k = t.ticker.toUpperCase();
    const prev = by.get(k);
    if (!prev || t.filedAt > prev.filedAt) by.set(k, { ...t, ticker: k });
  }
  return [...by.values()].sort((a, b) => (a.filedAt < b.filedAt ? 1 : -1));
}

/** Default holding horizon when the filing states no expected close — deals typically close ~3-5
 *  months after the definitive proxy; 120 days is a deliberately conservative annualizer. */
export const DEFAULT_CLOSE_DAYS = 120;

/**
 * SPACs and blank-check combinations are not merger-arb — their "deal price" is a $10 trust, not a
 * premium to an operating business. Filter by the well-known name markers (the same signal the IPO
 * monitor uses to exclude SPAC units).
 */
export function isSpac(name: string): boolean {
  return /\bacquisition corp|\bblank check|\bspecial purpose acquisition|\bcapital corp\b.*\b(unit|warrant)/i.test(name);
}

/**
 * Spread + annualized return for a cash deal. `daysToClose` from the stated close (or the default).
 * Null spread for non-cash or a missing quote — never a fabricated number. A NEGATIVE spread (stock
 * above the deal price) is kept and shown: it means the market expects a bump or a competing bid.
 */
export function spreadMath(cashPerShare: number | null, spot: number | null, daysToClose: number): {
  spreadPct: number | null;
  annualizedPct: number | null;
} {
  if (cashPerShare == null || spot == null || !(spot > 0)) return { spreadPct: null, annualizedPct: null };
  const spread = (cashPerShare - spot) / spot;
  const days = Math.max(1, daysToClose);
  return {
    spreadPct: +(spread * 100).toFixed(2),
    annualizedPct: +(spread * (365 / days) * 100).toFixed(1),
  };
}

/** Verify a cash price appears in the filing text as a dollar amount (same guard as /tenders). */
export function priceInText(text: string, price: number): boolean {
  if (!(price > 0)) return false;
  const a = price.toFixed(2).replace(".", "\\.");
  const b = String(price).replace(".", "\\.");
  return new RegExp(`\\$\\s?(${a}|${b})\\b|(${a}|${b})\\s+(?:per\\s+share|in\\s+cash)`, "i").test(text);
}
