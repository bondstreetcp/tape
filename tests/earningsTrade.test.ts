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
