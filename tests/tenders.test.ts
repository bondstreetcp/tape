import { test } from "node:test";
import assert from "node:assert/strict";
import { dedupeOffers, detectOddLotPriority, oddLotMath, priceInText, tickersFromDisplayName, type TenderRow } from "../lib/tenders";

// /tenders — the odd-lot monitor's pure half, pinned to what the first live scans exposed:
// a bare "124" verifying against a page number, one tender appearing six times across
// amendments/dual-filer copies, and multi-listed display names defeating a single-ticker regex.

test("odd-lot priority needs the phrase NEAR the grant, not just anywhere", () => {
  const grant =
    "Upon the terms and subject to the conditions of the Offer, shares tendered by any Odd Lot Holder (a holder of fewer than 100 shares) will be accepted for purchase before proration, without being subject to proration.";
  assert.equal(detectOddLotPriority(grant), true);
  // "odd lot" in a definitions section with no priority language nearby is not a grant.
  const definition = `"Odd Lots" means share amounts below one hundred. ${"x".repeat(2000)} The offer is subject to standard terms.`;
  assert.equal(detectOddLotPriority(definition), false);
  assert.equal(detectOddLotPriority("no such language at all"), false);
});

test("price verification demands a DOLLAR amount — bare numbers are page numbers", () => {
  const text = "the purchase price of $27.34 per Share in cash. See page 124 of this Offer to Purchase.";
  assert.equal(priceInText(text, 27.34), true);
  assert.equal(priceInText(text, 124), false); // the live NUVL bug: 124 was a page number
  assert.equal(priceInText("a price of $124.00 per share", 124), true);
  assert.equal(priceInText("purchase 3.15 per share for", 3.15), true); // "per share" adjacency also accepts
  assert.equal(priceInText(text, 99.99), false);
});

test("one row per OFFER: amendments supersede, latest filing wins, expiry breaks ties", () => {
  const mk = (over: Partial<TenderRow>): TenderRow => ({
    ticker: "GNK", name: "Genco", form: "SC TO-T", filedAt: "2026-07-01", offerType: "fixed",
    priceUsd: 24.8, priceHighUsd: null, expiresAt: null, oddLotPriority: false, verified: true,
    spot: null, premiumPct: null, oddLotValueUsd: null, conditions: null, url: "u1", ...over,
  });
  const out = dedupeOffers([
    mk({}), // original at 24.80
    mk({ filedAt: "2026-07-08", priceUsd: 27.34, url: "u2" }), // the bump
    mk({ filedAt: "2026-07-08", priceUsd: 27.34, expiresAt: "2026-07-24", url: "u3" }), // same day, adds expiry
  ]);
  assert.equal(out.length, 1, "amendments + copies collapse to one offer");
  assert.equal(out[0].priceUsd, 27.34, "the amended price supersedes the original");
  assert.equal(out[0].expiresAt, "2026-07-24", "expiry presence breaks the same-day tie");
  // Different FORM on the same ticker (a self-tender alongside a third-party offer) stays separate.
  assert.equal(dedupeOffers([mk({}), mk({ form: "SC TO-I" })]).length, 2);
});

test("odd-lot math uses the conservative low bound", () => {
  const m = oddLotMath(27.34, 26.04);
  assert.equal(m.premiumPct, 4.99);
  assert.equal(m.oddLotValueUsd, 129); // (27.34 − 26.04) × 99
  assert.deepEqual(oddLotMath(null, 26), { premiumPct: null, oddLotValueUsd: null });
  assert.deepEqual(oddLotMath(27, null), { premiumPct: null, oddLotValueUsd: null });
});

test("display-name ticker parsing: multi-listings and CIK-only names", () => {
  assert.deepEqual(tickersFromDisplayName("Priority Income Fund, Inc.  (PRIF-PD, PRIF-PK, PRIF-PL)  (CIK 0001554625)"), ["PRIF-PD", "PRIF-PK", "PRIF-PL"]);
  assert.deepEqual(tickersFromDisplayName("TPG Twin Brook Capital Income Fund  (CIK 0001913724)"), []);
  assert.deepEqual(tickersFromDisplayName("Genco Shipping & Trading Ltd  (GNK)  (CIK 0001326200)"), ["GNK"]);
});
