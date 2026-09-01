import { test } from "node:test";
import assert from "node:assert/strict";
import { conversionRatio, bondFloor, convertibleValue, impliedIssueVol, volEdge, estimateCreditSpread, convertCarry, creditQuality, convertVolFromPrice, type ConvertibleTerms } from "../lib/convertible";

// A representative AI-name convert: $150 conversion price on a $100 stock (50% premium), 0.5% coupon,
// 5-year, $1000 par. r = 4%, credit spread 3% (unrated growth).
const T: ConvertibleTerms = { ticker: "AICO", conversionPrice: 150, refPrice: 100, coupon: 0.005, maturityYears: 5 };
const R = 0.04, CS = 0.03;

test("conversion ratio = par / conversion price", () => {
  assert.ok(Math.abs(conversionRatio(T) - 1000 / 150) < 1e-9);
});

test("bond floor: rises with coupon, falls with credit spread, = PV(par) at zero coupon", () => {
  assert.ok(bondFloor({ ...T, coupon: 0.02 }, R, CS) > bondFloor({ ...T, coupon: 0.005 }, R, CS));
  assert.ok(bondFloor(T, R, 0.05) < bondFloor(T, R, 0.02));
  const zero = bondFloor({ ...T, coupon: 0 }, R, CS);
  assert.ok(Math.abs(zero - 1000 * Math.exp(-(R + CS) * 5)) < 1e-6);
});

test("value ≥ bond floor; delta within (0, ratio); moneyness classified", () => {
  const v = convertibleValue(T, 100, 0.5, R, CS);
  assert.ok(v.value >= v.bondFloor);
  assert.ok(v.delta > 0 && v.delta < conversionRatio(T));
  assert.ok(v.gamma > 0, "a live convert has positive gamma (the arb engine)");
  assert.ok(v.vega > 0, "a live convert is long vega (the embedded call)");
  assert.ok(v.equitySensitivity >= 0 && v.equitySensitivity <= 1.2);
  assert.equal(convertibleValue(T, 50, 0.5, R, CS).moneyness, "busted"); // parity ~33% of par
  assert.equal(convertibleValue(T, 150, 0.5, R, CS).moneyness, "balanced"); // parity = par
  assert.equal(convertibleValue(T, 220, 0.5, R, CS).moneyness, "in-the-money");
});

test("implied issue vol round-trips: plug it back → the convert prices at par", () => {
  const iv = impliedIssueVol(T, R, CS);
  assert.ok(iv != null && (iv as number) > 0.1 && (iv as number) < 2, `iv ${iv}`);
  const val = convertibleValue(T, T.refPrice as number, iv as number, R, CS).value;
  assert.ok(Math.abs(val - 1000) < 1, `re-priced to ${val}, want ~1000`);
});

test("a fatter conversion premium requires a higher issue vol (more OTM embedded call)", () => {
  const lo = impliedIssueVol({ ...T, conversionPrice: 130 }, R, CS) as number; // 30% premium
  const hi = impliedIssueVol({ ...T, conversionPrice: 160 }, R, CS) as number; // 60% premium
  assert.ok(hi > lo, `expected steeper premium → higher vol, got ${lo} then ${hi}`);
});

test("issue vol can be derived from the premium when no reference price is given", () => {
  const iv = impliedIssueVol({ ticker: "X", conversionPrice: 150, premium: 0.5, coupon: 0.005, maturityYears: 5 }, R, CS);
  assert.ok(iv != null && Number.isFinite(iv as number));
});

test("vol edge: convert issued below listed vol reads cheap (the arb signal)", () => {
  assert.equal(volEdge(0.4, 0.6).verdict, "cheap");
  assert.equal(volEdge(0.6, 0.6).verdict, "fair");
  assert.equal(volEdge(0.72, 0.6).verdict, "rich");
});

test("carry: coupon minus borrow + dividend drag on the short; HTB flips it negative", () => {
  const easy = convertCarry(0.005, 0.45, 0.0025, 0); // 0.25% (general collateral) borrow
  assert.ok(easy.net > 0, `easy borrow → positive carry, got ${easy.net}`);
  const htb = convertCarry(0.005, 0.45, 0.2, 0); // 20% (hard-to-borrow) borrow
  assert.ok(htb.net < -0.05, `HTB borrow → deeply negative carry, got ${htb.net}`);
  assert.ok(Math.abs(htb.borrowDrag - 0.09) < 1e-9); // 0.45 × 0.20
  const div = convertCarry(0.005, 0.45, 0.0025, 0.02); // + a 2% dividend the short pays
  assert.ok(div.net < easy.net, "a dividend the short pays lowers carry");
});

test("convertVolFromPrice recovers the vol from a priced convert (round-trip), null under the floor", () => {
  const S = 120;
  const priced = convertibleValue(T, S, 0.55, R, CS).value; // price this convert at 55% vol
  const v = convertVolFromPrice(T, S, priced, R, CS);
  assert.ok(v != null && Math.abs((v as number) - 0.55) < 0.01, `recovered ${v}, want ~0.55`);
  assert.equal(convertVolFromPrice(T, S, 1, R, CS), null); // a price under the bond floor → no vol
});

test("credit quality: net-cash & FCF-positive = solid; cash-burner short runway = distressed", () => {
  const solid = creditQuality({ totalCash: 5e9, freeCashflow: 1e9, marketCap: 5e10, enterpriseValue: 4.6e10 }); // EV < mkt cap → net cash
  assert.equal(solid.tier, "solid");
  assert.ok((solid.netDebt as number) < 0);
  const distressed = creditQuality({ totalCash: 1e9, freeCashflow: -1e9, marketCap: 5e9, enterpriseValue: 5e9 }); // burning, ~1y runway
  assert.equal(distressed.tier, "distressed");
  assert.ok(Math.abs((distressed.runwayYears as number) - 1) < 1e-9);
  const soft = creditQuality({ totalCash: 2e9, freeCashflow: -1e9, marketCap: 5e9, enterpriseValue: 5e9 }); // ~2y runway
  assert.equal(soft.tier, "soft");
});

test("credit-spread estimate rises with coupon and is clamped", () => {
  assert.ok(Math.abs(estimateCreditSpread(0) - 0.02) < 1e-9);
  assert.ok(estimateCreditSpread(0.05) > estimateCreditSpread(0.005));
  assert.ok(estimateCreditSpread(0.2) <= 0.09); // capped
  assert.ok(estimateCreditSpread(-1) >= 0.015); // floored
});
