import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bizDaysBetween,
  calDaysBetween,
  capturedVolPts,
  pickSellCandidates,
  computeStats,
  IV_CEIL,
  PREMIUM_CEIL,
  type VpClosed,
} from "../lib/volPremiumLedger";
import type { VolDisRow } from "../lib/volDislocation";

test("bizDaysBetween: counts weekdays strictly after a, through b; 0 when b<=a", () => {
  // Mon 2026-08-03 → Mon 2026-08-31: 4 full weeks = 20 trading days (holidays ignored).
  assert.equal(bizDaysBetween("2026-08-03", "2026-08-31"), 20);
  assert.equal(bizDaysBetween("2026-08-07", "2026-08-10"), 1); // Fri→Mon = one weekday (Mon)
  assert.equal(bizDaysBetween("2026-08-10", "2026-08-10"), 0);
  assert.equal(bizDaysBetween("2026-08-10", "2026-08-03"), 0); // reversed → 0, never negative
});

test("calDaysBetween: plain calendar delta", () => {
  assert.equal(calDaysBetween("2026-08-01", "2026-08-31"), 30);
});

test("capturedVolPts: IV sold minus realized printed", () => {
  assert.ok(Math.abs(capturedVolPts(0.45, 0.30) - 0.15) < 1e-9); // sold 45 vol, realized 30 → kept 15 pts
  assert.ok(capturedVolPts(0.30, 0.55) < 0); // realized blew past → seller lost
});

const R = (o: Partial<VolDisRow>): VolDisRow => ({
  symbol: "X", name: "X", sector: "Tech", price: 50, marketCap: 1e9,
  atmIV: 0.5, rvol: 0.3, ivPremium: 1.67, termCrush: null, skew: null, ivRank: null, rvolRank: null,
  daysToEarnings: null, earningsDriven: false, sectorPremium: null, vsSector: null, pctile: 95,
  illiquid: false, broad: false, ...o,
});

test("pickSellCandidates: keeps liquid non-earnings rich vol, richest pctile first", () => {
  const rows = [
    R({ symbol: "AAA", pctile: 92, ivPremium: 1.5 }),
    R({ symbol: "BBB", pctile: 99, ivPremium: 1.8 }),
    R({ symbol: "EARN", pctile: 100, earningsDriven: true }), // rich because a print is coming — excluded
    R({ symbol: "THIN", pctile: 100, illiquid: true }), // junk IV — excluded
    R({ symbol: "LOWP", pctile: 60 }), // not cross-sectionally rich — excluded
  ];
  const got = pickSellCandidates(rows, { maxN: 10 }).map((r) => r.symbol);
  assert.deepEqual(got, ["BBB", "AAA"]); // richest pctile first, the three excluded gone
});

test("pickSellCandidates: plausibility ceilings drop data artifacts", () => {
  const rows = [
    R({ symbol: "OK", atmIV: 0.6, ivPremium: 2.0 }),
    R({ symbol: "ABSURD_IV", atmIV: IV_CEIL + 0.5, ivPremium: 2.0 }), // 250% IV — artifact
    R({ symbol: "ABSURD_PREM", atmIV: 0.6, ivPremium: PREMIUM_CEIL + 1 }), // IV/RV = 7 — artifact
    R({ symbol: "PENNY", price: 1.5, atmIV: 0.6, ivPremium: 2.0 }), // sub-$3 — excluded
  ];
  assert.deepEqual(pickSellCandidates(rows, { maxN: 10 }).map((r) => r.symbol), ["OK"]);
});

test("computeStats: hit rate + median + worst/best surface the catalyst blow-ups", () => {
  const c = (symbol: string, cap: number): VpClosed => ({
    symbol, name: symbol, sector: "Tech", entryDate: "2026-07-01", atmIVEntry: 0.5, rvolEntry: 0.3,
    ivPremiumEntry: 1.67, pctileEntry: 95, priceEntry: 50, maturedDate: "2026-07-29",
    rvRealized: 0.5 - cap, capturedVolPts: cap, capturedFrac: cap / 0.5, won: cap > 0,
  });
  const closed = [c("W1", 0.10), c("W2", 0.06), c("W3", 0.20), c("L1", -0.30)];
  const s = computeStats(closed)!;
  assert.equal(s.n, 4);
  assert.equal(s.hitRate, 0.75); // 3 of 4 won
  assert.ok(Math.abs(s.medianCaptured - 0.08) < 1e-9); // median of [-.3,.06,.1,.2] = (.06+.1)/2
  assert.equal(s.worst[0].symbol, "L1"); // the blow-up surfaces first
  assert.equal(s.best[0].symbol, "W3");
  assert.equal(computeStats([]), null);
});
