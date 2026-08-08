import { test } from "node:test";
import assert from "node:assert/strict";
import { tradeIdea } from "../lib/earningsTrade";
import type { OptionChain, Opt } from "../lib/options";

// tradeIdea's condor-vs-strangle switch must be driven by the skew of the CHAIN IT PRICES ON (the
// event chain both the card route and the nightly logger pass) — regression for the drift where the
// route fed base-chain skew via optionsR and the logger fed event-chain skew, so the track record
// could log a different structure than the card showed.

const opt = (strike: number, iv: number): Opt => ({ strike, last: 2, bid: 1.9, ask: 2.1, vol: 100, oi: 500, iv, itm: false });

// Synthetic event chain: spot 100, strikes 80..120. `atmPutIvBump` sets the ATM (100-strike) put IV
// above the call IV — the put-skew that flips a rich name from short strangle to iron condor.
function chainWith(atmPutIvBump: number): OptionChain {
  const strikes = [80, 85, 90, 95, 100, 105, 110, 115, 120];
  return {
    underlying: 100,
    expirations: ["2026-07-17"],
    selected: "2026-07-17",
    calls: strikes.map((k) => opt(k, 0.5)),
    puts: strikes.map((k) => opt(k, k === 100 ? 0.5 + atmPutIvBump : 0.5)),
  };
}

const richness = { verdict: "rich", avgRealized: 4 };
const straddle = { lowerBE: 94, upperBE: 106, price: 100, expiry: "2026-07-17", dte: 10 };

test("tradeIdea: put-skewed EVENT chain → iron condor; flat chain → short strangle (skew single-sourced)", () => {
  const condor = tradeIdea(richness, null, straddle, chainWith(0.10), 6);
  assert.equal(condor?.structure, "Iron condor (defined risk)");
  const strangle = tradeIdea(richness, null, straddle, chainWith(0), 6);
  assert.equal(strangle?.structure, "Short strangle");
});

test("tradeIdea: optionsR cannot override the chain's own skew (card and logger agree by construction)", () => {
  // optionsR carries only positioning extras (max-pain / walls) — passing them must not flip the
  // structure that the chain's skew dictates.
  const withExtras = tradeIdea(richness, { maxPainVsSpot: 0.02, callWall: { strike: 110 }, putWall: { strike: 90 } }, straddle, chainWith(0.10), 6);
  const bare = tradeIdea(richness, null, straddle, chainWith(0.10), 6);
  assert.equal(withExtras?.structure, bare?.structure);
  assert.equal(bare?.structure, "Iron condor (defined risk)");
});

test("tradeIdea: cheap verdict owns the move regardless of skew", () => {
  const cheap = tradeIdea({ verdict: "cheap", avgRealized: 9 }, null, straddle, chainWith(0.10), 6);
  assert.equal(cheap?.structure, "Long straddle / strangle");
  assert.ok(cheap?.legsData?.every((l) => l.side === "long"));
});

// ── catalyst withholding (2026-07-24, Sam): a rich verdict with a LIVE strategic-alt/spin-off must
// NOT emit any short-premium structure — the elevated implied move is priced event risk. ──
const CATALYST = { kind: "strategic-alt" as const, headline: "Board initiates review of strategic alternatives", date: "2026-07-01" };

test("rich + live catalyst → play withheld: no legs to log, no short-premium alt, flag carried", () => {
  const t = tradeIdea(richness, null, straddle, chainWith(0.1), 6, null, CATALYST);
  assert.ok(t, "still returns an idea object (the card must explain, not go blank)");
  assert.equal(t!.legsData, undefined, "no priced legs — the nightly logger logs nothing");
  assert.equal(t!.alt, null, "short-premium alts suppressed too");
  assert.match(t!.structure, /No play/i);
  assert.match(t!.rationale, /strategic-alternatives/);
  assert.equal(t!.catalystWithheld?.date, "2026-07-01");
});

test("cheap + live catalyst → long-vol play unaffected (owning the move into a binary is not the trap)", () => {
  const t = tradeIdea({ verdict: "cheap", avgRealized: 9 }, null, straddle, chainWith(0.1), 6, null, CATALYST);
  assert.ok(t?.legsData, "long straddle still fully priced");
  assert.equal(t!.structure, "Long straddle / strangle");
  assert.equal(t!.catalystWithheld, undefined, "nothing withheld on the long side");
});

test("rich + NO catalyst → behavior unchanged (regression guard for the new parameter)", () => {
  const t = tradeIdea(richness, null, straddle, chainWith(0.1), 6, null, null);
  assert.ok(t?.legsData, "short structure still emitted when no catalyst is live");
  assert.match(t!.structure, /Iron condor|Short strangle/);
});

test("straddleMove: sparse chain with a one-sided nearest strike → ATM picked from BOTH-legged strikes (the EAT case)", async () => {
  const { straddleMove } = await import("../lib/earningsTrade");
  // Spot 100.4: the union-nearest strike (100) has a CALL but NO PUT — exactly Yahoo's sparse EAT
  // chain (230C quoted, no 230P), which used to null the whole read (implied move, verdict, play).
  // The nearest strike carrying BOTH legs is 105; the straddle must resolve there, not die at 100.
  const chain: OptionChain = {
    underlying: 100.4,
    expirations: ["2026-08-21"],
    selected: "2026-08-21",
    calls: [90, 95, 100, 105, 110].map((k) => opt(k, 0.5)),
    puts: [90, 95, 105, 110].map((k) => opt(k, 0.5)), // no 100 put
  };
  const sm = await straddleMove("TEST", chain, null); // expiry === selected → no refetch, pure
  assert.ok(sm, "straddle must resolve on a both-legged strike instead of nulling out");
  assert.equal(sm!.atmStrike, 105);
  assert.ok(Math.abs(sm!.movePct - (4 / 100.4) * 100) < 0.01, `movePct from the 105 straddle, got ${sm!.movePct}`);
});

// ── acquisition + preannounce: BOTH sides withheld ──
// An acquired name's stock is pinned to deal terms (long vol = paying for movement the deal forbids
// — the KVUE long-straddle report); a preannounced name's print is no longer the event the realized
// history graded (the IBM case). Unlike strategic-alt (short side only), these stand aside entirely.

const ACQ = { kind: "acquisition" as const, headline: "Definitive merger proxy (DEFM14A) filed — under agreement to be acquired", date: "2026-07-15" };
const PRE = { kind: "preannounce" as const, headline: "8-K Item 2.02 (prelim results) filed 2026-07-28, 14d ahead of the scheduled print", date: "2026-07-28" };

test("acquisition: rich AND cheap both withheld — no legs, no alts, kind surfaced", () => {
  for (const verdict of ["rich", "cheap"] as const) {
    const t = tradeIdea({ verdict, avgRealized: 6 }, null, straddle, chainWith(0.1), 6, null, ACQ);
    assert.ok(t, `${verdict}: card still explains`);
    assert.match(t!.structure, /No play — being acquired/);
    assert.equal(t!.legsData, undefined, `${verdict}: nothing for the logger to grade`);
    assert.equal(t!.alt, null);
    assert.equal(t!.catalystWithheld?.kind, "acquisition");
  }
});

test("preannounce: rich AND cheap both withheld (both comparisons against normal-print history are contaminated)", () => {
  for (const verdict of ["rich", "cheap"] as const) {
    const t = tradeIdea({ verdict, avgRealized: 6 }, null, straddle, chainWith(0.1), 6, null, PRE);
    assert.ok(t);
    assert.match(t!.structure, /No play — preannounced/);
    assert.equal(t!.legsData, undefined);
    assert.equal(t!.catalystWithheld?.kind, "preannounce");
  }
});

test("strategic-alt still withholds the SHORT side only (long straddle untouched) — regression", () => {
  const long = tradeIdea({ verdict: "cheap", avgRealized: 9 }, null, straddle, chainWith(0.1), 6, null, CATALYST);
  assert.equal(long!.structure, "Long straddle / strangle");
  assert.ok(long!.legsData);
});
