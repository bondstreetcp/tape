import { test } from "node:test";
import assert from "node:assert/strict";
import { quarterize, despikeQuarters, ttmSum, yoyChange, classifyBuyback, type DurFact, type InstFact } from "../lib/buybacks";

// A fiscal year's YTD-cumulative cash-flow ladder: all facts share the FY start, spans grow
// 3mo → 6mo → 9mo → 12mo, values accumulate. Correct quarters are the successive differences.
function fyLadder(year: number, cumVals: [number, number, number, number]): DurFact[] {
  const start = `${year}-01-01`;
  const ends = [`${year}-03-31`, `${year}-06-30`, `${year}-09-30`, `${year}-12-31`];
  return cumVals.map((val, i) => ({ start, end: ends[i], val, fy: year, accn: `a${year}${i}` }));
}

test("quarterize de-cumulates a YTD ladder without double-counting Q1 (the fixed bug)", () => {
  const q = quarterize(fyLadder(2024, [10, 25, 45, 70]));
  assert.deepEqual(q.map((x) => x.val), [10, 15, 20, 25]); // NOT [10,25,20,25]
  assert.equal(q.reduce((s, x) => s + x.val, 0), 70); // quarters sum to the FY total
});

test("quarterize does NOT emit an annual-only fact as a fake quarter (the overstatement bug)", () => {
  // A filer whose companyfacts carries only the 12-month figure (no clean quarterly ladder): booking
  // it as a 'quarter' would 4× the TTM. It must yield zero quarters → caller falls back to annual.
  const annualOnly: DurFact[] = [{ start: "2024-01-01", end: "2024-12-31", val: 8_000_000_000, accn: "a1" }];
  assert.equal(quarterize(annualOnly).length, 0);
  // A gap (Q1 then jump to FY, missing Q2/Q3) → only the last ~quarter increment is booked, not the lump
  const gap: DurFact[] = [
    { start: "2024-01-01", end: "2024-03-31", val: 10, accn: "a1" }, // Q1 (span 90) → quarter
    { start: "2024-01-01", end: "2024-12-31", val: 70, accn: "a2" }, // FY (incremental span 275) → NOT a quarter
  ];
  assert.deepEqual(quarterize(gap).map((x) => x.val), [10]);
});

test("quarterize handles discrete-quarter reporting (each quarter its own start)", () => {
  const discrete: DurFact[] = [
    { start: "2024-01-01", end: "2024-03-31", val: 10, accn: "a1" },
    { start: "2024-04-01", end: "2024-06-30", val: 15, accn: "a2" },
    { start: "2024-07-01", end: "2024-09-30", val: 20, accn: "a3" },
  ];
  assert.deepEqual(quarterize(discrete).map((x) => x.val), [10, 15, 20]);
});

test("quarterize keeps latest-filed on a restated (start,end) and drops negative artifacts", () => {
  const restated: DurFact[] = [
    { start: "2024-01-01", end: "2024-03-31", val: 10, accn: "a1" },
    { start: "2024-01-01", end: "2024-03-31", val: 12, accn: "a9" }, // restatement, higher accn wins
    { start: "2024-01-01", end: "2024-06-30", val: 8, accn: "a2" }, // H1 < Q1 → negative Q2 artifact, dropped
  ];
  const q = quarterize(restated);
  assert.equal(q.find((x) => x.end === "2024-03-31")!.val, 12);
  assert.ok(!q.some((x) => x.val < 0), "no negative quarters survive");
});

test("ttmSum needs 4 quarters within ~400d, else null (caller falls back to annual)", () => {
  const q = [...fyLadder(2024, [10, 25, 45, 70])].map((f) => ({ end: f.end, val: 0 }));
  // build a real 5-quarter series and check TTM = last 4
  const series = [
    { end: "2023-12-31", val: 20 },
    { end: "2024-03-31", val: 10 },
    { end: "2024-06-30", val: 15 },
    { end: "2024-09-30", val: 20 },
    { end: "2024-12-31", val: 25 },
  ];
  const ttm = ttmSum(series)!;
  assert.equal(ttm.val, 70); // 10+15+20+25
  assert.equal(ttm.asOf, "2024-12-31");
  assert.equal(ttmSum(series.slice(0, 3)), null); // <4 quarters
  const gapped = [{ end: "2020-12-31", val: 5 }, ...series.slice(2)]; // spans >400d
  assert.equal(ttmSum(gapped), null);
});

test("ttmSum rejects a mid-series gap even when the 4-quarter span sneaks under a year", () => {
  // A despiked MID-series quarter leaves a hole: the surviving last-4 span only ~1y (<400d, so the
  // total-span guard passes) but one internal step is ~half a year — that must NOT be sold as a clean
  // TTM (it would silently substitute the year-ago quarter for the missing one).
  const gapped = [
    { end: "2024-06-30", val: 3 },
    { end: "2024-09-30", val: 3.5 }, // 2024-12-31 removed as a spike → the gap is right here
    { end: "2025-03-31", val: 4 },
    { end: "2025-06-30", val: 4.2 },
  ];
  // total span 2024-06-30 → 2025-06-30 = 365d (under 400, the old guard passed it) but 09-30→03-31 = 182d
  assert.equal(ttmSum(gapped), null);
});

test("despikeQuarters drops a bad-data outlier quarter (the CRM $27B-vs-$3B-norm case)", () => {
  const q = [
    { end: "2025-04-30", val: 2.6e9 },
    { end: "2025-07-31", val: 2.2e9 },
    { end: "2025-10-31", val: 3.8e9 },
    { end: "2026-01-31", val: 3.9e9 },
    { end: "2026-04-30", val: 27.25e9 }, // XBRL fault — 8× the median
  ];
  const clean = despikeQuarters(q);
  assert.ok(!clean.some((x) => x.val > 10e9), "the spike is removed");
  assert.equal(clean.length, 4);
  // TTM off the cleaned series is the real ~$12.5B, not the inflated ~$37B
  assert.ok(Math.abs(ttmSum(clean)!.val - 12.5e9) < 0.1e9);
  // a genuinely steady ramp is NOT clipped
  const ramp = [{ end: "a", val: 3e9 }, { end: "b", val: 3.5e9 }, { end: "c", val: 4e9 }, { end: "d", val: 5e9 }];
  assert.equal(despikeQuarters(ramp).length, 4);
});

test("yoyChange is negative when the share count shrinks", () => {
  const shares: InstFact[] = [
    { end: "2023-12-31", val: 1000 },
    { end: "2024-12-31", val: 950 }, // −5% YoY
  ];
  assert.ok(Math.abs(yoyChange(shares)! - -0.05) < 1e-9);
  assert.equal(yoyChange([{ end: "2024-12-31", val: 950 }]), null); // no comparable
  // a ~2y gap doesn't qualify as a YoY comparable
  assert.equal(yoyChange([{ end: "2022-12-31", val: 1000 }, { end: "2024-12-31", val: 950 }]), null);
});

test("classifyBuyback assigns the right badges", () => {
  const base = { symbol: "X", name: "X", sector: "T", marketCap: 1e12, price: 1, buybackTtm: 1e10, buybackYield: 0.03, dividendYield: 0.025, totalYield: 0.055, netShareChangePct: -0.03, buybackAccel: 1.4, payoutToFcf: 1.3, asOf: "2024-12-31" };
  const badges = classifyBuyback(base);
  assert.ok(badges.includes("shrinking") && badges.includes("high-yield") && badges.includes("accelerating") && badges.includes("overdistributing"));
  assert.ok(!badges.includes("no-buyback"));
  // a dividend-only name with a flat count
  const divOnly = { ...base, buybackTtm: null, buybackYield: null, totalYield: 0.025, netShareChangePct: 0.001, buybackAccel: null, payoutToFcf: 0.6 };
  const b2 = classifyBuyback(divOnly);
  assert.ok(b2.includes("no-buyback") && !b2.includes("shrinking") && !b2.includes("high-yield") && !b2.includes("accelerating") && !b2.includes("overdistributing"));
});
