import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPortfolioIncome } from "../lib/portfolioIncome";
import type { CallSuggestion, PutWriteCandidate } from "../lib/putwrite";

const call = (o: Partial<CallSuggestion> & { expiry: string; premium: number }): CallSuggestion => ({
  dte: 30, strike: 110, delta: 0.3, iv: 0.25, premiumSrc: "mid", yieldPct: 0.02, annPct: 0.24,
  ifCalledPct: 0.12, ifCalledAnnPct: 0.4, capPct: 0.1, breakeven: 98, ...o,
});
const cand = (o: Partial<PutWriteCandidate> & { symbol: string }): PutWriteCandidate => ({
  name: o.symbol + " Inc", sector: "Tech", price: 100, marketCap: 5e9, roe: 0.2, pe: 20, divYield: null,
  nextEarnings: null, earningsEstimate: false, rvol: 0.2, rvolRank: 50, atmIV: 0.25, ivRank: 50, ivPremium: 1.2,
  puts: { m1: null, m3: null }, calls: { m1: null, m3: null }, bullPuts: { m1: null, m3: null }, condors: { m1: null, m3: null },
  ...o,
});

const NOW = Date.UTC(2026, 6, 12);
const iso = (days: number) => new Date(NOW + days * 86_400_000).toISOString().slice(0, 10);

test("sizes premium in dollars: contracts = floor(shares/100), premium × 100 × contracts", () => {
  const cands = [cand({ symbol: "AAPL", calls: { m1: call({ expiry: iso(30), premium: 2.5 }), m3: null } })];
  const r = buildPortfolioIncome([{ symbol: "AAPL", shares: 350 }], cands, "m1", { nowMs: NOW });
  assert.equal(r.rows.length, 1);
  const row = r.rows[0];
  assert.equal(row.contracts, 3); // floor(350/100)
  assert.equal(row.premiumDollars, 750); // 2.5 × 100 × 3
  assert.equal(row.oddLot, false);
  assert.equal(r.totalPremium, 750);
});

test("odd lot (<100 shares): suggestion shown, but 0 contracts / 0 premium $ and flagged", () => {
  const cands = [cand({ symbol: "NVDA", calls: { m1: call({ expiry: iso(30), premium: 5 }), m3: null } })];
  const r = buildPortfolioIncome([{ symbol: "NVDA", shares: 60 }], cands, "m1", { nowMs: NOW });
  assert.equal(r.rows[0].contracts, 0);
  assert.equal(r.rows[0].premiumDollars, 0);
  assert.equal(r.rows[0].oddLot, true);
});

test("shorts can't be covered-call'd — excluded and counted; longs without a suggestion are uncovered", () => {
  const cands = [cand({ symbol: "AAPL", calls: { m1: call({ expiry: iso(30), premium: 2 }), m3: null } })];
  const r = buildPortfolioIncome(
    [{ symbol: "AAPL", shares: 100 }, { symbol: "TSLA", shares: -100 }, { symbol: "XYZ", shares: 200 }],
    cands, "m1", { nowMs: NOW },
  );
  assert.equal(r.shortsExcluded, 1); // TSLA short
  assert.equal(r.totalLongs, 2); // AAPL + XYZ (long)
  assert.equal(r.coveredLongs, 1); // only AAPL has a suggestion
  assert.deepEqual(r.uncovered, ["XYZ"]); // long, but not in the quality options universe
});

test("earnings-through-expiry flag fires only when the print lands inside the call window", () => {
  const before = cand({ symbol: "A", nextEarnings: new Date(NOW + 10 * 86_400_000).toISOString(), calls: { m1: call({ expiry: iso(30), premium: 1 }), m3: null } });
  const after = cand({ symbol: "B", nextEarnings: new Date(NOW + 50 * 86_400_000).toISOString(), calls: { m1: call({ expiry: iso(30), premium: 1 }), m3: null } });
  const r = buildPortfolioIncome([{ symbol: "A", shares: 100 }, { symbol: "B", shares: 100 }], [before, after], "m1", { nowMs: NOW });
  assert.equal(r.rows.find((x) => x.symbol === "A")!.earningsBeforeExpiry, true); // earnings @10d < expiry @30d
  assert.equal(r.rows.find((x) => x.symbol === "B")!.earningsBeforeExpiry, false); // earnings @50d > expiry @30d
});

test("earnings landing TODAY still flags during US market hours (now floored to UTC midnight)", () => {
  const afternoon = NOW + 15 * 3_600_000; // 15:00Z — mid US session, same calendar day as NOW
  const today = new Date(NOW).toISOString().slice(0, 10); // bare YYYY-MM-DD → parses to UTC midnight
  const c = cand({ symbol: "A", nextEarnings: today, calls: { m1: call({ expiry: iso(20), premium: 1 }), m3: null } });
  const r = buildPortfolioIncome([{ symbol: "A", shares: 100 }], [c], "m1", { nowMs: afternoon });
  assert.equal(r.rows[0].earningsBeforeExpiry, true); // print today (≤ expiry) must not read as already past
});

test("rows sort by biggest dollar premium first; m3 tenor selects the other suggestion", () => {
  const cands = [
    cand({ symbol: "SMALL", price: 50, calls: { m1: call({ expiry: iso(30), premium: 1 }), m3: null } }),
    cand({ symbol: "BIG", price: 400, calls: { m1: call({ expiry: iso(30), premium: 8 }), m3: call({ expiry: iso(90), premium: 20 }) } }),
  ];
  const r = buildPortfolioIncome([{ symbol: "SMALL", shares: 100 }, { symbol: "BIG", shares: 100 }], cands, "m1", { nowMs: NOW });
  assert.deepEqual(r.rows.map((x) => x.symbol), ["BIG", "SMALL"]); // 800 > 100
  const r3 = buildPortfolioIncome([{ symbol: "BIG", shares: 100 }], cands, "m3", { nowMs: NOW });
  assert.equal(r3.rows[0].premiumDollars, 2000); // m3 premium 20 × 100
});
