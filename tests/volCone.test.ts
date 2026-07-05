import { test } from "node:test";
import assert from "node:assert/strict";
import { buildVolCone, logReturnsOf, CONE_HORIZONS, type Daily } from "../lib/volCone";
import { realizedVol } from "../lib/putwrite";

const DAY = 86_400_000;
const approx = (a: number, b: number, tol = 1e-9) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

// Deterministic (no RNG) closes with time-varying vol → day-spaced series.
function series(fn: (i: number) => number, n: number): { closes: number[]; daily: Daily } {
  const closes: number[] = [];
  let p = 100;
  for (let i = 0; i < n; i++) { p *= Math.exp(fn(i)); closes.push(p); }
  return { closes, daily: closes.map((px, i) => [i * DAY, px] as [number, number]) };
}

test("cur20 matches putwrite.realizedVol(closes,21) exactly (one 'realized vol' app-wide)", () => {
  const { closes, daily } = series((i) => 0.02 * Math.sin(i / 7) + 0.005 * Math.cos(i / 3), 400);
  const row = buildVolCone("T", "T Co", "Tech", daily)!;
  assert.ok(row, "row built");
  approx(row.cur20!, realizedVol(closes, 21)!, 1e-9); // h=21 current == last-21-return realized vol
  approx(row.cur252!, realizedVol(closes, 252)!, 1e-9);
});

test("bands: all horizons present with enough history; ordered + current inside range", () => {
  const { daily } = series((i) => 0.015 * Math.sin(i / 9), 400);
  const row = buildVolCone("T", "T", "—", daily)!;
  assert.deepEqual(row.bands.map((b) => b.h), [...CONE_HORIZONS]); // 10,21,63,126,252
  for (const b of row.bands) {
    assert.ok(b.min <= b.p25 + 1e-9 && b.p25 <= b.med + 1e-9 && b.med <= b.p75 + 1e-9 && b.p75 <= b.max + 1e-9, `quantiles ordered @${b.h}`);
    assert.ok(b.cur! >= b.min - 1e-9 && b.cur! <= b.max + 1e-9, `cur in [min,max] @${b.h}`);
    assert.ok(b.pct! >= 0 && b.pct! <= 100);
    assert.ok(b.n >= 20);
  }
});

test("percentile flags extremes: recent vol spike → high pct20; recent calm → low pct20", () => {
  // calm for 360 days, then a volatile burst in the last ~30 → current 21d RV near the top of its cone
  const spike = buildVolCone("S", "S", "—", series((i) => (i < 360 ? 0.002 * Math.sin(i / 5) : 0.06 * Math.sin(i / 2)), 400).daily)!;
  assert.ok(spike.pct20! > 80, `spike pct20=${spike.pct20}`);
  // volatile for 360 days, then a calm tail → current 21d RV near the bottom
  const calm = buildVolCone("C", "C", "—", series((i) => (i < 360 ? 0.06 * Math.sin(i / 2) : 0.002 * Math.sin(i / 5)), 400).daily)!;
  assert.ok(calm.pct20! < 20, `calm pct20=${calm.pct20}`);
});

test("termSlope sign: recent spike ⇒ short vol > long vol ⇒ expanding (>0)", () => {
  const spike = buildVolCone("S", "S", "—", series((i) => (i < 360 ? 0.002 * Math.sin(i / 5) : 0.06 * Math.sin(i / 2)), 400).daily)!;
  assert.ok(spike.termSlope! > 0, `termSlope=${spike.termSlope}`);
});

test("split / bad-tick days are dropped (cone not inflated by a −60% split print)", () => {
  // calm ~1%/day, then a single −60% split artifact at i=380, then calm again
  const closes: number[] = []; let p = 100;
  for (let i = 0; i < 400; i++) { let r = 0.01 * Math.sin(i / 6); if (i === 380) r = Math.log(0.4); p *= Math.exp(r); closes.push(p); }
  const daily: Daily = closes.map((px, i) => [i * DAY, px] as [number, number]);
  const row = buildVolCone("SPL", "Split Co", "—", daily)!;
  // the −60% (|log|≈0.92 > 0.5) is dropped → current 21d RV reflects only the calm moves, not a phantom spike
  assert.ok(row.cur20! < 0.5, `cur20=${row.cur20} should not be inflated by the split`);
});

test("too little history → null", () => {
  const { daily } = series((i) => 0.01 * Math.sin(i), 25); // 24 returns < 21+20
  assert.equal(buildVolCone("X", "X", "—", daily), null);
});

test("logReturnsOf: day-buckets intraday ticks to one close per day", () => {
  // two intraday points on day 0, one on day 1, one on day 2 → 3 daily closes → 2 returns
  const daily: Daily = [
    [0, 100], [0 + 3600_000, 101], // same calendar day (last wins → 101)
    [DAY, 103], [2 * DAY, 106],
  ];
  const r = logReturnsOf(daily);
  assert.equal(r.length, 2);
  approx(r[0], Math.log(103 / 101), 1e-12);
});
