import { test } from "node:test";
import assert from "node:assert/strict";
import {
  beneishM, altmanZ, piotroskiF, sloanAccruals, assembleAnnual, dedupeQuarters, computeForensics,
  type Annual, type PQ,
} from "../lib/forensics";

const approx = (a: number | null, b: number, tol = 0.01) => assert.ok(a != null && Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

// A fully-populated annual builder so each test tweaks only what it exercises.
function A(o: Partial<Annual>): Annual {
  return {
    end: "2026-03-31",
    sales: 1000, ni: 100, cfo: 100, ebit: 150, dep: 100, sga: 200, gp: 400,
    ta: 1000, ca: 500, cl: 200, tl: 600, re: 300, ltd: 100, rec: 100, ppe: 300, shares: 100,
    taBegin: 1000, ...o,
  };
}

// ── Sloan accruals ────────────────────────────────────────────────────────────────────────────────
// accruals = (NI − CFO) / avgTA, avgTA = (ta + taBegin)/2. NI=100, CFO=60, ta=1100, taBegin=900:
// avgTA = 1000 → (100−60)/1000 = 0.04.
test("Sloan accruals = (NI−CFO)/avgTA", () => {
  approx(sloanAccruals(A({ ni: 100, cfo: 60, ta: 1100, taBegin: 900 })), 0.04, 1e-9);
  assert.equal(sloanAccruals(A({ ni: null })), null); // missing NI → null, never a wrong number
  assert.equal(sloanAccruals(A({ ta: 0, taBegin: 0 })), null); // avgTA ≤ 0 → null
});

// ── Altman Z (original 1968) ────────────────────────────────────────────────────────────────────
// X1=(ca−cl)/ta=(500−200)/1000=0.3; X2=re/ta=300/1000=0.3; X3=ebit/ta=150/1000=0.15;
// X4=mktcap/tl=1200/600=2.0; X5=sales/ta=1000/1000=1.0.
// Z = 1.2·0.3 + 1.4·0.3 + 3.3·0.15 + 0.6·2.0 + 1.0·1.0 = 0.36+0.42+0.495+1.2+1.0 = 3.475 → SAFE.
test("Altman Z original coefficients + zone", () => {
  approx(altmanZ(A({}), 1200, false), 3.475, 1e-9);
  assert.equal(altmanZ(A({}), 1200, true), null);   // financial → excluded (model invalid for banks)
  assert.equal(altmanZ(A({}), null, false), null);  // no market cap → null
  assert.equal(altmanZ(A({ tl: 0 }), 1200, false), null); // zero liabilities denom → null
});

// ── Piotroski F (0–9), current (t) vs prior (p) ──────────────────────────────────────────────────
// Strong company — every one of the 9 signals should fire (F=9):
//  ROA 0.114>0 ✓ · CFO 160>0 ✓ · ROA 0.114>0.08 ✓ · CFO/TA 0.152>ROA 0.114 ✓ ·
//  lev 0.143<0.20 ✓ · CR 2.5>2.0 ✓ · shares 100≤100 ✓ · GM 0.345>0.30 ✓ · turn 1.048>1.0 ✓.
test("Piotroski F = 9 for a uniformly improving company", () => {
  const p = A({ ni: 80, ta: 1000, cfo: 90, ltd: 200, ca: 400, cl: 200, shares: 100, gp: 300, sales: 1000 });
  const t = A({ ni: 120, ta: 1050, cfo: 160, ltd: 150, ca: 500, cl: 200, shares: 100, gp: 380, sales: 1100 });
  assert.equal(piotroskiF(t, p), 9);
});

// Weak company — only the accrual signal fires (CFO −5 > NI −10), everything else fails → F=1.
// This pins the SIGN of 8 signals (an inverted comparison would push the count off 1).
test("Piotroski F = 1 for a deteriorating company (only CFO>NI holds)", () => {
  const p = A({ ni: 100, ta: 1000, cfo: 120, ltd: 100, ca: 500, cl: 200, shares: 100, gp: 400, sales: 1000 });
  const t = A({ ni: -10, ta: 1100, cfo: -5, ltd: 200, ca: 300, cl: 250, shares: 120, gp: 300, sales: 900 });
  assert.equal(piotroskiF(t, p), 1);
  assert.equal(piotroskiF(A({ gp: null }), p), null); // any missing input → null (financials fall out here)
});

// ── Beneish M (8-variable) ───────────────────────────────────────────────────────────────────────
// Flat company (year t ≡ year t−1, NI=CFO): every index variable = 1.0 and TATA = 0, so
// M = −4.84 + (0.920+0.528+0.404+0.892+0.115−0.172−0.327)·1 + 4.679·0
//   = −4.84 + 2.360 = −2.48. This exercises (and pins) all eight coefficients at once.
test("Beneish M = −2.48 for an unchanged company (coefficient check)", () => {
  const flat = A({ ni: 100, cfo: 100 });
  approx(beneishM(flat, flat), -2.48, 0.005);
});

// Manipulation-like year (hand-worked, all eight variables ≠ 1 — catches inverted ratios):
//  DSRI=(180/1200)/(100/1000)=1.5 · GMI=(400/1000)/(420/1200)=1.142857 · AQI=0.2/0.2=1.0 ·
//  SGI=1200/1000=1.2 · DEPI=(100/400)/(100/420)=1.05 · SGAI=(260/1200)/(200/1000)=1.083333 ·
//  LVGI=(390/1100)/(300/1000)=1.181818 · TATA=(100−50)/1100=0.045455.
//  M = −4.84 + 0.920·1.5 + 0.528·1.142857 + 0.404·1.0 + 0.892·1.2 + 0.115·1.05
//        − 0.172·1.083333 + 4.679·0.045455 − 0.327·1.181818 = −1.62.
test("Beneish M ≈ −1.62 for a manipulation-like year (per-variable check)", () => {
  const p = A({ sales: 1000, rec: 100, gp: 400, ca: 500, ppe: 300, ta: 1000, dep: 100, sga: 200, ltd: 100, cl: 200 });
  const t = A({ sales: 1200, rec: 180, gp: 420, ca: 560, ppe: 320, ta: 1100, dep: 100, sga: 260, ltd: 150, cl: 240, ni: 100, cfo: 50 });
  approx(beneishM(t, p), -1.62, 0.01);
  assert.equal(beneishM(A({ rec: null }), p), null); // missing receivables → null
  assert.equal(beneishM(A({ sales: 0 }), p), null);  // zero sales denom → null
});

// ── assembleAnnual: TTM flows sum 4 quarters; instants take the period end ─────────────────────────
test("assembleAnnual: TTM sum + period-end instants + year-ago taBegin", () => {
  const q: PQ[] = [
    { d: "2024-06-30", rev: 10, ni: 1, ta: 900 },
    { d: "2024-09-30", rev: 20, ni: 2, ta: 950 },
    { d: "2024-12-31", rev: 30, ni: 3, ta: 980 },
    { d: "2025-03-31", rev: 40, ni: 4, ta: 1000 }, // ← window end
  ];
  const a = assembleAnnual(q, 3)!;
  assert.equal(a.sales, 100); // 10+20+30+40
  assert.equal(a.ni, 10);
  assert.equal(a.ta, 1000);   // period-end instant
  assert.equal(a.taBegin, null); // no quarter 4 back
  assert.equal(assembleAnnual(q, 2), null); // <4 quarters available
});

test("assembleAnnual: a gap in the quarterly panel voids the TTM flow (no partial-year 'annual')", () => {
  const q: PQ[] = [
    { d: "2023-03-31", rev: 10 }, { d: "2024-09-30", rev: 20 }, { d: "2024-12-31", rev: 30 }, { d: "2025-03-31", rev: 40 },
  ]; // first bar ~2yr before the last → window span > 460d → flow null
  assert.equal(assembleAnnual(q, 3)!.sales, null);
});

test("dedupeQuarters keeps the later of two near-duplicate ends", () => {
  const q: PQ[] = [{ d: "2025-03-31", rev: 1 }, { d: "2025-04-05", rev: 2 }, { d: "2025-06-30", rev: 3 }];
  const d = dedupeQuarters(q);
  assert.equal(d.length, 2);
  assert.deepEqual(d.map((x) => x.rev), [2, 3]); // 03-31 replaced by the 04-05 restatement
});

// ── computeForensics end-to-end from a flat 8-quarter panel ────────────────────────────────────────
// Flat quarterly fields (rev25/ni25/oi40/da25/cfo25/gp100/sga50 per quarter; balance-sheet instants
// ta1000/ca500/cl200/tl600/re300/ltd100/rec40/ppe300/shs100). TTM t ≡ TTM p → M=−2.48; NI=CFO → accruals 0;
// identical years → Piotroski fires only #2(CFO>0) & #7(no dilution) → F=... let's just assert the shape.
test("computeForensics assembles the panel and returns a populated row", () => {
  const ends = ["2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"];
  const q: PQ[] = ends.map((d) => ({ d, rev: 250, ni: 25, oi: 40, da: 25, cfo: 25, gp: 100, sga: 50, ta: 1000, ca: 500, cl: 200, tl: 600, re: 300, ltd: 100, rec: 40, ppe: 300, shs: 100 }));
  const row = computeForensics({ symbol: "TST", name: "Test Co", sector: "Information Technology", marketCap: 1200, etf: "XLK" }, q)!;
  assert.ok(row, "row built");
  assert.equal(row.asOf, "2026-03-31");
  approx(row.mScore, -2.48, 0.02);            // flat company baseline
  assert.equal(row.accruals, 0);              // NI=CFO across the TTM
  approx(row.zScore, 3.508, 0.01);            // 1.2·0.3+1.4·0.3+3.3·0.16+0.6·2+1·1
  assert.equal(row.zZone, "safe");
  assert.ok(row.fScore != null && row.fScore >= 0 && row.fScore <= 9);
});

// A gap BETWEEN the two 4-quarter windows (2018 block, then 2023 block — a data hole / fiscal-year
// change / re-listing) must NOT fabricate a "year-over-year" move. Both windows pass their internal
// span guard, but t (2023) vs p (2018) is 5 years apart → the YoY scores must go null, not compute a
// garbage Beneish/Piotroski that would sort to #1 with a manipulation flag.
test("computeForensics: a gap between the current and prior year → Beneish/Piotroski null (no fabricated move)", () => {
  const full = { rev: 250, ni: 25, oi: 40, da: 25, cfo: 25, gp: 100, sga: 50, ta: 1000, ca: 500, cl: 200, tl: 600, re: 300, ltd: 100, rec: 40, ppe: 300, shs: 100 };
  const dates = ["2018-03-31", "2018-06-30", "2018-09-30", "2018-12-31", "2023-03-31", "2023-06-30", "2023-09-30", "2023-12-31"];
  const q: PQ[] = dates.map((d) => ({ d, ...full }));
  const row = computeForensics({ symbol: "GAP", name: "Gap Co", sector: "Industrials", marketCap: 1200 }, q)!;
  assert.equal(row.mScore, null, "Beneish nulled across the 5-year gap");
  assert.equal(row.fScore, null, "Piotroski nulled across the 5-year gap");
  assert.equal(row.accruals, 0, "Sloan still computes from the current TTM alone (taBegin nulled by the gap)");
  assert.ok(row.zScore != null, "Altman still computes (single-period)");
});

// A TTM with D&A tagged exactly 0 makes the Beneish DEPI denominator 0 → must return null, never ∞/NaN.
test("Beneish M: zero-D&A returns null (no ∞ DEPI → bogus 'high' flag)", () => {
  assert.equal(beneishM(A({ dep: 0 }), A({})), null);
  assert.equal(beneishM(A({}), A({ dep: 0 })), null);
});

test("computeForensics: financial name → Altman null, but other scores still compute", () => {
  const ends = ["2024-06-30", "2024-09-30", "2024-12-31", "2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31", "2026-03-31"];
  const q: PQ[] = ends.map((d) => ({ d, rev: 250, ni: 25, oi: 40, da: 25, cfo: 20, gp: 100, sga: 50, ta: 1000, ca: 500, cl: 200, tl: 600, re: 300, ltd: 100, rec: 40, ppe: 300, shs: 100 }));
  const row = computeForensics({ symbol: "BNK", name: "Bank Co", sector: "Financials", marketCap: 1200, etf: "XLF" }, q)!;
  assert.equal(row.zScore, null); // excluded
  assert.ok(row.mScore != null);  // Beneish still computes
});
