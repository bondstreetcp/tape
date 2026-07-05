import { test } from "node:test";
import assert from "node:assert/strict";
import { distToFlipPct, buildGammaRow, nearFlip, rankGammaBoard, type GammaBoardRow } from "../lib/gammaBoard";

const approx = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

test("distToFlipPct: signed % of spot; null when no flip / bad spot", () => {
  approx(distToFlipPct(100, 95)!, 5); // spot 5% above flip
  approx(distToFlipPct(100, 105)!, -5); // spot below flip (short-gamma side)
  assert.equal(distToFlipPct(100, null), null);
  assert.equal(distToFlipPct(0, 95), null);
});

test("buildGammaRow: derives flip distance + regime from sign of net gamma", () => {
  const shortRow = buildGammaRow({
    symbol: "AAA", name: "A Co", sector: "Tech", spot: 100, totalGex: -5e8, grossGex: 2e9,
    flip: 104, pcRatio: 1.4, callWall: { strike: 110, oi: 5000 }, putWall: { strike: 90, oi: 8000 }, expiries: 3,
  });
  assert.equal(shortRow.regime, "short"); // negative net gamma
  approx(shortRow.distToFlipPct!, -4); // 100 vs 104
  const longRow = buildGammaRow({ ...shortRow, totalGex: 5e8, flip: 96 });
  assert.equal(longRow.regime, "long");
  approx(longRow.distToFlipPct!, 4);
});

test("nearFlip: within threshold of the regime boundary", () => {
  assert.equal(nearFlip({ distToFlipPct: 2 }), true); // default 3%
  assert.equal(nearFlip({ distToFlipPct: -2.9 }), true);
  assert.equal(nearFlip({ distToFlipPct: 5 }), false);
  assert.equal(nearFlip({ distToFlipPct: null }), false);
  assert.equal(nearFlip({ distToFlipPct: 4 }, 5), true); // custom threshold
});

const mk = (o: Partial<GammaBoardRow>): GammaBoardRow => ({
  symbol: "X", name: "X", sector: "—", spot: 100, totalGex: 0, grossGex: 0, flip: null,
  distToFlipPct: null, regime: "long", pcRatio: null, callWall: null, putWall: null, expiries: 1, ...o,
});

test("rankGammaBoard: each lens orders correctly", () => {
  const rows = [
    mk({ symbol: "BIG", grossGex: 9e9, totalGex: 3e9, distToFlipPct: 8, pcRatio: 0.6 }),
    mk({ symbol: "SHORT", grossGex: 2e9, totalGex: -4e9, distToFlipPct: -1, pcRatio: 2.1 }),
    mk({ symbol: "MID", grossGex: 5e9, totalGex: 1e9, distToFlipPct: 3, pcRatio: 1.0 }),
  ];
  assert.equal(rankGammaBoard(rows, "gross")[0].symbol, "BIG"); // biggest positioning
  assert.equal(rankGammaBoard(rows, "short")[0].symbol, "SHORT"); // most negative net gamma
  assert.equal(rankGammaBoard(rows, "long")[0].symbol, "BIG");
  assert.equal(rankGammaBoard(rows, "flip")[0].symbol, "SHORT"); // nearest the boundary
  assert.equal(rankGammaBoard(rows, "pcHigh")[0].symbol, "SHORT"); // most put-heavy
  assert.equal(rankGammaBoard(rows, "pcLow")[0].symbol, "BIG"); // most call-heavy
  // non-mutating
  assert.equal(rows[0].symbol, "BIG");
});
