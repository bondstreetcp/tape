import { test } from "node:test";
import assert from "node:assert/strict";
import { pickCommon, trustPerShare, discountPct, PLAUSIBLE_MAX_DISCOUNT } from "../lib/spacArb";

const L = (...t: string[]) => t.map((ticker) => ({ ticker }));

// pickCommon is the load-bearing fix — the ticker bug that fabricated 99% "discounts" bit twice
// (warrants, then rights). These pin the common-vs-derivative decision.
test("pickCommon: base that all derivatives extend wins (common present)", () => {
  assert.equal(pickCommon(L("IROQR", "IROQ", "IROQW"))?.ticker, "IROQ"); // common is the shorter base
  assert.equal(pickCommon(L("APXTU", "APXT", "APXTW"))?.ticker, "APXT");
});

test("pickCommon: unambiguous derivative forms and missing-base sets → drop", () => {
  assert.equal(pickCommon(L("ABCDWT")), null); // lone warrant, no-separator
  assert.equal(pickCommon(L("ABCD-WT")), null); // dashed warrant
  assert.equal(pickCommon(L("ABCDUN")), null); // no-separator unit
  assert.equal(pickCommon(L("ABCDRT")), null); // bare right (multi-char)
  assert.equal(pickCommon(L("IROQW", "IROQR")), null); // two derivatives extend a missing base (IROQ)
  assert.equal(pickCommon(L("IROQW", "IROQR", "IROQU")), null); // three, still missing base
});

test("pickCommon: a lone bare-suffix listing is kept (ambiguous) — the plausibility ceiling catches it", () => {
  // A lone IROQW COULD be a warrant (base unlisted) or a coincidence; ticker alone can't decide, so
  // it's kept here and the >15% "discount" it would produce is what flags it downstream.
  assert.equal(pickCommon(L("IROQW"))?.ticker, "IROQW");
});

test("pickCommon: a legitimate common ending in U/W/R is NOT false-dropped", () => {
  assert.equal(pickCommon(L("BOW"))?.ticker, "BOW"); // real common ending in W
  assert.equal(pickCommon(L("NU"))?.ticker, "NU"); // real common ending in U
  assert.equal(pickCommon(L("PTOR"))?.ticker, "PTOR"); // real common ending in R (Praetorian)
});

test("trustPerShare + discountPct: below-trust is positive, degenerate inputs abstain", () => {
  assert.ok(Math.abs((trustPerShare(103_500_000, 10_000_000) as number) - 10.35) < 1e-9);
  assert.equal(trustPerShare(100, 0), null);
  assert.ok(Math.abs((discountPct(10.35, 9.9) as number) - 0.0435) < 1e-3); // ~4.3% below floor
  assert.ok((discountPct(10.35, 10.5) as number) < 0); // above floor = negative
  assert.equal(discountPct(10.35, null), null); // unpriced
});

test("plausibility ceiling: a warrant-priced 'discount' is far past the ceiling", () => {
  // A right at $0.30 vs a $10.90 floor → ~97% 'discount' — flagged unverified, never a headline.
  assert.ok((discountPct(10.9, 0.3) as number) > PLAUSIBLE_MAX_DISCOUNT);
  // A real 2% discount is well under it.
  assert.ok((discountPct(10.35, 10.14) as number) < PLAUSIBLE_MAX_DISCOUNT);
});
