import { test } from "node:test";
import assert from "node:assert/strict";
import { netCredit, settleLegs, payoffBounds, summarize, settlePostPrint, type TradeLeg, type TradeRec } from "../lib/tradeLog";
import { bsPrice, ivFromPrice } from "../lib/blackScholes";

// The settlement math IS the track record's scorecard — a sign error here silently reports losing
// plays as winners. Pin every structure the card actually suggests.

const shortPut = (k: number, prem: number): TradeLeg => ({ type: "P", side: "short", strike: k, premium: prem });
const longPut = (k: number, prem: number): TradeLeg => ({ type: "P", side: "long", strike: k, premium: prem });
const longCall = (k: number, prem: number): TradeLeg => ({ type: "C", side: "long", strike: k, premium: prem });
const shortCall = (k: number, prem: number): TradeLeg => ({ type: "C", side: "short", strike: k, premium: prem });

test("netCredit: short collects, long pays", () => {
  assert.equal(netCredit([shortPut(100, 2)]), 2);
  assert.equal(netCredit([longCall(100, 3)]), -3);
  assert.equal(netCredit([shortPut(100, 2), longPut(95, 1)]), 1); // bull put spread: +2 − 1
});

test("settleLegs: cash-secured short put", () => {
  assert.equal(settleLegs([shortPut(100, 2)], 105), 2); // expires worthless → keep the credit
  assert.equal(settleLegs([shortPut(100, 2)], 95), -3); // assigned: owe 5 intrinsic, net −3
});

test("settleLegs: long call", () => {
  assert.equal(settleLegs([longCall(100, 3)], 110), 7); // −3 paid + 10 intrinsic
  assert.equal(settleLegs([longCall(100, 3)], 95), -3); // expires worthless → lose the premium
});

test("settleLegs: bull put spread caps both ends", () => {
  const spread = [shortPut(100, 2), longPut(95, 1)]; // net credit 1, width 5
  assert.equal(settleLegs(spread, 105), 1); // both OTM → max profit = credit
  assert.equal(settleLegs(spread, 90), -4); // both ITM → max loss = −(width − credit)
  assert.equal(settleLegs(spread, 98), -1); // short 2 ITM, long OTM → 1 − 2
});

test("payoffBounds: bull put spread is bounded both ways", () => {
  const b = payoffBounds([shortPut(100, 2), longPut(95, 1)]);
  assert.equal(b.maxProfit, 1);
  assert.equal(b.maxLoss, -4);
});
test("payoffBounds: long call has unbounded upside, capped loss", () => {
  const b = payoffBounds([longCall(100, 3)]);
  assert.equal(b.maxProfit, null); // unbounded up
  assert.equal(b.maxLoss, -3); // can only lose the premium
});
test("payoffBounds: naked short call has unbounded loss, capped profit", () => {
  const b = payoffBounds([shortCall(100, 3)]);
  assert.equal(b.maxLoss, null); // unbounded up
  assert.equal(b.maxProfit, 3); // keep the credit at best
});
test("payoffBounds: long put is bounded (downside floored at S=0)", () => {
  const b = payoffBounds([longPut(100, 3)]);
  assert.equal(b.maxProfit, 97); // S=0 → 100 intrinsic − 3
  assert.equal(b.maxLoss, -3);
});

// summarize aggregates the scorecard: win rate over settled, split by rich/cheap, plus how often the
// realized move cleared the implied.
test("summarize: counts, win rate, verdict split, cleared", () => {
  const base = {
    name: "", loggedAt: "", asOfDate: "", earningsDate: "", structure: "", legsText: "", expiry: "", dte: 7,
    spotAtRec: 100, impliedMovePct: 8, avgRealizedPct: 6, richnessRatio: 1.3, legs: [], entryCredit: 0, maxProfit: null, maxLoss: null,
  };
  const recs: TradeRec[] = [
    { ...base, id: "A", symbol: "A", verdict: "rich", status: "settled", pnl: 1.5, outcome: "win", moveCleared: false },
    { ...base, id: "B", symbol: "B", verdict: "rich", status: "settled", pnl: -2.0, outcome: "loss", moveCleared: true },
    { ...base, id: "C", symbol: "C", verdict: "cheap", status: "settled", pnl: 0.0, outcome: "scratch", moveCleared: true },
    { ...base, id: "D", symbol: "D", verdict: "cheap", status: "settled", pnl: 3.0, outcome: "win", moveCleared: true },
    { ...base, id: "E", symbol: "E", verdict: "rich", status: "awaiting_print" }, // open — excluded from settled stats
  ];
  const s = summarize(recs);
  assert.equal(s.settledN, 4);
  assert.equal(s.wins, 2);
  assert.equal(s.losses, 1);
  assert.equal(s.scratches, 1);
  assert.equal(s.winRate, 2 / 3); // wins / (wins + losses); scratches excluded
  assert.equal(s.openN, 1);
  assert.ok(Math.abs(s.totalPnl - 2.5) < 1e-9); // 1.5 − 2 + 0 + 3
  assert.equal(s.clearedN, 4); // recs with moveCleared != null (A false, B/C/D true) — false still counts
  assert.equal(s.cleared, 3); // of those, moveCleared === true (B, C, D)
  assert.equal(s.byVerdict.rich.n, 2);
  assert.equal(s.byVerdict.rich.wins, 1);
  assert.equal(s.byVerdict.cheap.n, 2);
  assert.equal(s.byVerdict.cheap.wins, 1);
});

test("summarize: empty input yields null rates, not NaN or a throw", () => {
  const s = summarize([]);
  assert.equal(s.settledN, 0);
  assert.equal(s.winRate, null);
  assert.equal(s.avgPnl, null);
  assert.equal(s.totalPnl, 0);
  assert.equal(s.preprintN, 0);
});

// settlePostPrint is the new HEADLINE grade — reprice the structure the morning after the print with
// the event vol stripped out. The earnings thesis must fall out correctly: a bought straddle wins on a
// big move and loses when the print is quiet; a sold straddle is the mirror image.
const recBase = {
  name: "", loggedAt: "", asOfDate: "", earningsDate: "", structure: "", legsText: "", expiry: "",
  sector: undefined, verdict: "cheap" as const, status: "awaiting_print" as const,
  avgRealizedPct: 6, richnessRatio: 1.3, maxProfit: null, maxLoss: null,
};
// An ATM straddle whose leg premiums come from Black-Scholes at an elevated pre-earnings vol, so the
// implied move is internally consistent (ivFromPrice recovers the same vol).
function straddleRec(side: "long" | "short"): TradeRec {
  const S = 100, K = 100, Tentry = 10 / 365, sig = 0.8;
  const call = +bsPrice("call", S, K, Tentry, sig).toFixed(2);
  const put = +bsPrice("put", S, K, Tentry, sig).toFixed(2);
  const legs: TradeLeg[] = [
    { type: "C", side, strike: K, premium: call },
    { type: "P", side, strike: K, premium: put },
  ];
  return {
    ...recBase, id: side, symbol: side, dte: 10, spotAtRec: S,
    impliedMovePct: +(((call + put) / S) * 100).toFixed(2), legs, entryCredit: +netCredit(legs).toFixed(2),
  };
}

test("settlePostPrint: bought straddle wins on a big move, loses on a quiet print", () => {
  const long = straddleRec("long");
  const big = settlePostPrint(long, 115, 8)!; // stock jumped +15%, well past the ~10.5% implied
  const quiet = settlePostPrint(long, 100.5, 8)!; // print was a dud — the straddle got vol-crushed
  assert.ok(big > 0, `big move should pay the long straddle, got ${big}`);
  assert.ok(quiet < 0, `quiet print should lose for the long straddle, got ${quiet}`);
  assert.ok(big > quiet);
});

test("settlePostPrint: sold straddle is the mirror image of the bought one", () => {
  const short = straddleRec("short");
  const big = settlePostPrint(short, 115, 8)!;
  const quiet = settlePostPrint(short, 100.5, 8)!;
  assert.ok(big < 0, "a big move hurts the premium seller");
  assert.ok(quiet > 0, "a quiet print pays the premium seller (vol crush)");
});

test("settlePostPrint: null on a degenerate spot", () => {
  assert.equal(settlePostPrint(straddleRec("long"), 0, 8), null);
  assert.equal(settlePostPrint(straddleRec("long"), -5, 8), null);
});

test("settlePostPrint: residual is scaled to the REMAINING time, not the whole life", () => {
  // Regression for the variance-scaling fix. The residual leg must be repriced with the annualized
  // residual vol √(remVar/Tentry) held constant over Tpost — NOT the whole-life variance forced into
  // Tpost. Use an event that resolves only PART of the 10-day vol so a real residual remains (the
  // synthetic straddle otherwise has eventVar ≈ whole variance → nothing left to scale).
  const long = { ...straddleRec("long"), impliedMovePct: 7 };
  const reactionSpot = 100, daysToExp = 8; // ATM, 8 of the 10 days left
  const Tentry = long.dte / 365, Tpost = daysToExp / 365;
  const eventVar = Math.pow(long.impliedMovePct / 100 / 0.8, 2);

  let expected = 0, buggy = 0;
  for (const l of long.legs) {
    const kind = l.type === "C" ? "call" : "put";
    const sigEntry = ivFromPrice(kind, long.spotAtRec, l.strike, Tentry, l.premium)!;
    const remVar = Math.max(sigEntry * sigEntry * Tentry - eventVar, 0);
    assert.ok(remVar > 0, "test needs a non-degenerate residual");
    expected += bsPrice(kind, reactionSpot, l.strike, Tpost, Math.sqrt(remVar / Tentry)) - l.premium; // correct
    buggy += bsPrice(kind, reactionSpot, l.strike, Tpost, Math.sqrt(remVar / Tpost)) - l.premium; // whole-life bug
  }
  const got = settlePostPrint(long, reactionSpot, daysToExp)!;
  assert.ok(Math.abs(got - expected) < 1e-9, `settlePostPrint must match the remaining-time residual: expected ${expected}, got ${got}`);
  assert.ok(buggy > got + 0.05, "the old whole-life scaling over-credited the long residual — the fix must not regress");
});
