/**
 * Odd-lot tender monitor — types + the pure, testable half of /tenders.
 *
 * THE EDGE, and why it belongs on a small-account screen: tender offers routinely give holders of
 * FEWER THAN 100 SHARES priority acceptance with no proration — a term that exists to let issuers
 * shed the cost of tiny holders, and that institutions structurally cannot use (99 shares is not a
 * position, it's a rounding error). Buying 99 shares below the offer price and tendering into the
 * priority is one of the few return streams that exists BECAUSE the account is small. Each event is
 * worth (offer − spot) × 99, typically a few hundred dollars, several times a year. Sparse by
 * nature: the page must say "nothing open right now" honestly, never render blank.
 *
 * The risks the UI must carry (this is a monitor, not a promise): Dutch-auction tenders have a RANGE
 * (the final price can land at the low end — the shown premium uses the LOW bound, conservatively);
 * offers carry conditions and can be amended or pulled; the spot usually already reflects most of
 * the offer; and a same-day quote near the offer means the market expects completion, not free money.
 *
 * Doctrine: the LLM proposes terms, CODE verifies — every extracted number must literally appear in
 * the filing text or the row is marked unverified and the number is dropped.
 */

export interface TenderRow {
  ticker: string;
  name: string;
  form: string; // SC TO-I (self-tender) | SC TO-T (third-party)
  filedAt: string; // YYYY-MM-DD
  /** fixed = one price; dutch = a range (final price set by the auction — we show the LOW bound). */
  offerType: "fixed" | "dutch" | "unknown";
  priceUsd: number | null; // fixed price, or the LOW end of a Dutch range
  priceHighUsd: number | null; // Dutch high end; null for fixed
  expiresAt: string | null; // YYYY-MM-DD calendar square
  oddLotPriority: boolean; // the filing grants <100-share holders priority acceptance
  /** verification verdict: numbers above were found verbatim in the filing text */
  verified: boolean;
  spot: number | null; // live quote at scan time
  premiumPct: number | null; // (low offer − spot) / spot, null without both
  /** the whole point: (low offer − spot) × 99, the max value of one odd-lot, pre-fees */
  oddLotValueUsd: number | null;
  conditions: string | null; // one-line LLM summary of material conditions
  url: string; // EDGAR filing index
}

export interface TendersFile {
  generatedAt: string;
  windowDays: number;
  rows: TenderRow[];
  scanned: number; // raw EFTS hits in the window (mostly unlisted interval funds)
  unlisted: number; // hits with no listed ticker — skipped
}

/** Does the filing text grant odd-lot priority? The phrasings observed across real tenders. */
const ODD_LOT_RE =
  /odd\s*lots?|fewer\s+than\s+(?:100|one\s+hundred)\s+shares|less\s+than\s+(?:100|one\s+hundred)\s+shares|holders?\s+of\s+(?:99|ninety-?nine)\s+or\s+fewer/i;

export function detectOddLotPriority(text: string): boolean {
  // The phrase must appear NEAR priority/proration language — "odd lot" alone can be a definition
  // section; "will be accepted... without proration" near it is the grant.
  if (!ODD_LOT_RE.test(text)) return false;
  const m = ODD_LOT_RE.exec(text)!;
  const around = text.slice(Math.max(0, m.index - 1500), m.index + 1500).toLowerCase();
  // The grant's observed phrasings: "priority", "before proration", "without (being) subject to
  // proration", "not (be) subject to proration", "accepted first / in full".
  return /priorit|before\s+proration|(?:without|not)\s+(?:being\s+|be\s+)?subject\s+to\s+proration|accepted?\s+(?:for\s+purchase\s+)?(?:first|in\s+full|before)/.test(around);
}

/**
 * Verify an extracted dollar figure appears in the text (as $X, X.XX, with or without commas).
 * The verification the whole feature hangs on — a fabricated tender price is worse than none.
 */
export function priceInText(text: string, price: number): boolean {
  if (!(price > 0)) return false;
  // A DOLLAR AMOUNT, not a bare number: "124" matches page numbers and share counts, so verification
  // demands the $ (or "per share" adjacency) — observed live: an extracted 124 "verified" against a
  // page number before this required the currency context.
  const fixed2 = price.toFixed(2).replace(".", "\\.");
  const noTrail = String(price).replace(".", "\\.");
  const commas = price.toFixed(2).replace(/\B(?=(\d{3})+(?!\d))/g, ",").replace(/\./g, "\\.").replace(/,/g, ",?");
  const alts = [...new Set([fixed2, noTrail, commas])].join("|");
  return new RegExp(`\\$\\s?(${alts})\\b|(${alts})\\s+per\\s+share`, "i").test(text);
}

/** Premium + odd-lot value, from the conservative LOW bound. */
export function oddLotMath(priceUsd: number | null, spot: number | null): { premiumPct: number | null; oddLotValueUsd: number | null } {
  if (priceUsd == null || spot == null || !(spot > 0)) return { premiumPct: null, oddLotValueUsd: null };
  const premiumPct = +(((priceUsd - spot) / spot) * 100).toFixed(2);
  const oddLotValueUsd = +((priceUsd - spot) * 99).toFixed(0);
  return { premiumPct, oddLotValueUsd };
}

/**
 * One row per OFFER, not per filing: amendments (SC TO-I/A) and multi-filer copies (offeror + target
 * both file the same tender) produce many accessions for one deal — observed live, one tender showed
 * six times. Key = ticker + low price; keep the row with the LATEST filedAt, preferring one that
 * carries an expiry over one that doesn't (amendments often add the date the original lacked).
 */
export function dedupeOffers(rows: TenderRow[]): TenderRow[] {
  const by = new Map<string, TenderRow>();
  for (const r of rows) {
    // ticker+form, NOT ticker+price: amendments change the price (a bump supersedes the original) and
    // the expiry (extensions) — the LATEST filing describes the offer as it stands. Expiry presence
    // breaks filed-same-day ties (an /A often adds the date the original omitted).
    const key = `${r.ticker}|${r.form}`;
    const cur = by.get(key);
    if (!cur) { by.set(key, r); continue; }
    const better =
      r.filedAt.localeCompare(cur.filedAt) ||
      (r.expiresAt ? 1 : 0) - (cur.expiresAt ? 1 : 0);
    if (better > 0) by.set(key, r);
  }
  return [...by.values()];
}

/** Tickers from an EFTS display_name — handles multi-listing "(PRIF-PD, PRIF-PK)" and skips CIK. */
export function tickersFromDisplayName(dn: string): string[] {
  const out: string[] = [];
  for (const m of dn.matchAll(/\(([^)]+)\)/g)) {
    const inner = m[1].trim();
    if (/^CIK/i.test(inner)) continue;
    for (const part of inner.split(",")) {
      const t = part.trim();
      if (/^[A-Z][A-Z0-9.\-]{0,7}$/.test(t)) out.push(t);
    }
  }
  return [...new Set(out)];
}
