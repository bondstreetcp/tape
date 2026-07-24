import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseOptionLine, timeToExpiry, priceLeg, summarizeOptions, deltaEquivalentShares, scenarioOptionsPnl,
  splitBook, CONTRACT_MULTIPLIER, type OptionLeg,
} from "../lib/optionsBook";
import { parsePositions } from "../lib/portfolio";

// Fixed "now" so every expectation is deterministic (no hidden clock).
const NOW = Date.UTC(2026, 0, 16); // 2026-01-16
const IN_1Y = "2027-01-15";

test("parseOptionLine: long calls, short puts, decimal strike, optional premium", () => {
  assert.deepEqual(parseOptionLine("AAPL C250 2026-06-19 x10"), {
    symbol: "AAPL", kind: "call", strike: 250, expiry: "2026-06-19", contracts: 10,
  });
  assert.deepEqual(parseOptionLine("aapl p200 2026-06-19 x-5"), {
    symbol: "AAPL", kind: "put", strike: 200, expiry: "2026-06-19", contracts: -5,
  });
  // premium given → carried through so the leg can back out its own IV
  assert.deepEqual(parseOptionLine("BRK-B C412.50 2026-06-19 x2 @12.40"), {
    symbol: "BRK-B", kind: "call", strike: 412.5, expiry: "2026-06-19", contracts: 2, premium: 12.4,
  });
});

test("parseOptionLine: rejects share lines and malformed legs", () => {
  assert.equal(parseOptionLine("AAPL 100"), null); // a plain share line
  assert.equal(parseOptionLine("AAPL C250 x10"), null); // no expiry
  assert.equal(parseOptionLine("AAPL C250 2026-06-19 x0"), null); // zero contracts isn't a position
  assert.equal(parseOptionLine("AAPL X250 2026-06-19 x1"), null); // not a call/put
});

test("splitBook: option legs peeled off, share lines survive for parsePositions", () => {
  const { legs, sharesText } = splitBook("AAPL 100\nAAPL C250 2026-06-19 x10\n# note\nMSFT 60\nAAPL P200 2026-06-19 x-5");
  assert.deepEqual(legs.map((l) => `${l.symbol}${l.kind[0]}${l.strike}x${l.contracts}`), ["AAPLc250x10", "AAPLp200x-5"]);
  // what's left still parses as a normal share book — the two parsers never see each other's lines
  assert.deepEqual(parsePositions(sharesText), [{ symbol: "AAPL", shares: 100 }, { symbol: "MSFT", shares: 60 }]);
});

test("timeToExpiry: ~1y out, 0 once expired", () => {
  assert.ok(Math.abs(timeToExpiry(IN_1Y, NOW) - 1) < 0.01);
  assert.equal(timeToExpiry("2020-01-01", NOW), 0);
});

test("priceLeg: ATM call — delta ≈ +0.5/share, positive vega, negative theta, sized by 100×contracts", () => {
  const leg: OptionLeg = { symbol: "X", kind: "call", strike: 100, expiry: IN_1Y, contracts: 10 };
  const p = priceLeg(leg, 100, 0.3, NOW)!;
  const qty = 10 * CONTRACT_MULTIPLIER;
  assert.ok(p.deltaShares > 0.5 * qty && p.deltaShares < 0.7 * qty); // ATM call delta ~0.55-0.6 with drift
  assert.ok(Math.abs(p.deltaDollar - p.deltaShares * 100) < 1e-9);
  assert.ok(p.marketValue > 0); // long premium = positive value
  assert.ok(p.vegaDollar > 0, "long option is long vol");
  assert.ok(p.thetaDollar < 0, "long option decays");
  assert.ok(p.gammaDollar > 0, "long option is long gamma");
  assert.equal(p.ivFromPremium, false);
});

test("priceLeg: short put — positive delta (bullish), negative vega/gamma, positive theta", () => {
  const leg: OptionLeg = { symbol: "X", kind: "put", strike: 100, expiry: IN_1Y, contracts: -5 };
  const p = priceLeg(leg, 100, 0.3, NOW)!;
  assert.ok(p.deltaShares > 0, "short put is long the underlying");
  assert.ok(p.marketValue < 0, "written premium is a liability");
  assert.ok(p.vegaDollar < 0 && p.gammaDollar < 0, "short option is short vol/gamma");
  assert.ok(p.thetaDollar > 0, "short option collects decay");
});

test("priceLeg: a premium backs out the leg's own IV (overrides the estimate)", () => {
  const leg: OptionLeg = { symbol: "X", kind: "call", strike: 100, expiry: IN_1Y, contracts: 1, premium: 18 };
  const p = priceLeg(leg, 100, 0.20, NOW)!; // estimate 20% ignored in favour of the premium
  assert.equal(p.ivFromPremium, true);
  assert.ok(p.iv > 0.25, "an $18 ATM 1y call implies well above the 20% estimate");
  assert.ok(Math.abs(p.price - 18) < 0.05, "reprices back to (about) the premium paid");
});

test("priceLeg: null without a spot or any vol; expired leg collapses to intrinsic", () => {
  const leg: OptionLeg = { symbol: "X", kind: "call", strike: 100, expiry: IN_1Y, contracts: 1 };
  assert.equal(priceLeg(leg, 0, 0.3, NOW), null);
  assert.equal(priceLeg(leg, 100, null, NOW), null);
  const expired = priceLeg({ ...leg, expiry: "2020-01-01" }, 130, 0.3, NOW)!;
  assert.ok(Math.abs(expired.price - 30) < 1e-6); // deep ITM at expiry = intrinsic
  assert.equal(expired.deltaShares, CONTRACT_MULTIPLIER); // full delta
});

test("summarizeOptions + deltaEquivalentShares: aggregates and splits by underlying", () => {
  const legs: OptionLeg[] = [
    { symbol: "AAPL", kind: "call", strike: 100, expiry: IN_1Y, contracts: 10 },
    { symbol: "AAPL", kind: "put", strike: 90, expiry: IN_1Y, contracts: -4 },
    { symbol: "MSFT", kind: "call", strike: 200, expiry: IN_1Y, contracts: 3 },
    { symbol: "NOPE", kind: "call", strike: 50, expiry: IN_1Y, contracts: 1 }, // no spot → unpriced
  ];
  const spot: Record<string, number> = { AAPL: 100, MSFT: 200 };
  const s = summarizeOptions(legs, (x) => spot[x] ?? null, () => 0.3, NOW);
  assert.equal(s.legs.length, 3);
  assert.deepEqual(s.unpriced.map((l) => l.symbol), ["NOPE"]);
  assert.ok(s.deltaDollar > 0 && s.vegaDollar !== 0);
  // aggregate == sum of the parts
  assert.ok(Math.abs(s.deltaDollar - s.legs.reduce((a, p) => a + p.deltaDollar, 0)) < 1e-9);

  const eq = deltaEquivalentShares(s.legs);
  assert.deepEqual([...eq.keys()].sort(), ["AAPL", "MSFT"]);
  // AAPL nets the long call and the short put (both bullish → both positive)
  assert.ok(eq.get("AAPL")! > 0);
  assert.ok(Math.abs(eq.get("MSFT")! - s.legs.find((p) => p.leg.symbol === "MSFT")!.deltaShares) < 1e-9);
});

test("scenarioOptionsPnl: a protective put shows POSITIVE convexity in a crash", () => {
  // Long puts: a linear (delta-only) read understates the payoff in a big down move.
  const legs = [priceLeg({ symbol: "X", kind: "put", strike: 100, expiry: IN_1Y, contracts: 10 }, 100, 0.3, NOW)!];
  const crash = scenarioOptionsPnl(legs, -0.20);
  assert.ok(crash.pnl > 0, "puts pay off in a crash");
  assert.ok(crash.convexity > 0, "gamma means the real payoff beats the delta-only estimate");
  // ... and a rally costs LESS than linear predicts (the premium is the floor).
  const rally = scenarioOptionsPnl(legs, 0.20);
  assert.ok(rally.convexity > 0, "long gamma is convex in both directions");
  assert.ok(rally.pnl > -legs[0].marketValue - 1e-6, "cannot lose more than the premium paid");
});

test("scenarioOptionsPnl: a vol spike helps long options, and short gamma is concave", () => {
  const longCall = [priceLeg({ symbol: "X", kind: "call", strike: 100, expiry: IN_1Y, contracts: 5 }, 100, 0.3, NOW)!];
  const flatWithVol = scenarioOptionsPnl(longCall, 0, 10); // +10 vol points, no move
  assert.ok(flatWithVol.pnl > 0 && flatWithVol.linearPnl === 0, "vega-only P&L is invisible to a delta model");

  const shortCall = [priceLeg({ symbol: "X", kind: "call", strike: 100, expiry: IN_1Y, contracts: -5 }, 100, 0.3, NOW)!];
  const up = scenarioOptionsPnl(shortCall, 0.20);
  assert.ok(up.convexity < 0, "short gamma loses more than the linear estimate");
});
