import { test } from "node:test";
import assert from "node:assert/strict";
import { computePortfolio, scenarioPnL, parsePositions, type NameData, type Position } from "../lib/portfolio";

const approx = (a: number, b: number, tol = 1e-6) => assert.ok(Math.abs(a - b) <= tol, `${a} ≈ ${b}`);

const data = new Map<string, NameData>([
  ["AAPL", { symbol: "AAPL", price: 200, sector: "Tech", beta: 1.2, ret: 5 }],
  ["MSFT", { symbol: "MSFT", price: 400, sector: "Tech", beta: 1.1, ret: 3 }],
  ["TSLA", { symbol: "TSLA", price: 250, sector: "Consumer", beta: 2.0, ret: -10 }],
]);
const positions: Position[] = [
  { symbol: "AAPL", shares: 100 }, // +$20k
  { symbol: "MSFT", shares: 50 }, // +$20k
  { symbol: "TSLA", shares: -20 }, // −$5k (short)
];

test("computePortfolio: value/exposure/concentration/beta/return", () => {
  const s = computePortfolio(positions, data);
  approx(s.gross, 45000);
  approx(s.net, 35000);
  approx(s.longValue, 40000);
  approx(s.shortValue, -5000);
  // sorted by |value| desc; ties keep insertion-ish, both $20k first
  assert.equal(s.holdings.length, 3);
  approx(s.holdings[2].value, -5000); // TSLA smallest
  // sector: Tech +$40k, Consumer −$5k
  const tech = s.bySector.find((x) => x.sector === "Tech")!;
  approx(tech.value, 40000);
  approx(tech.weight, 40000 / 45000);
  // concentration (fractions of gross)
  approx(s.concentration.top1, 20000 / 45000);
  approx(s.concentration.top5, 1); // only 3 names
  approx(s.concentration.hhi, (20000 / 45000) ** 2 * 2 + (5000 / 45000) ** 2);
  // net beta = Σ value·beta / gross = (24000+22000−10000)/45000 = 0.8
  approx(s.beta!, 0.8);
  approx(s.betaCoverage, 1);
  // gross-weighted return = (20k·5 + 20k·3 + 5k·−10)/45k = 110000/45000
  approx(s.ret!, 110000 / 45000);
});

test("scenarioPnL: beta-weighted market shock", () => {
  const s = computePortfolio(positions, data);
  const down5 = scenarioPnL(s, -5); // Σ value·beta·(−0.05) = 36000·−0.05 = −1800
  approx(down5.dollar, -1800);
  approx(down5.pct, -4); // −1800 / 45000
  approx(scenarioPnL(s, 10).dollar, 3600); // linear
});

test("computePortfolio: unpriced positions → missing, don't crash", () => {
  const s = computePortfolio([...positions, { symbol: "NOPE", shares: 10 }, { symbol: "ZERO", shares: 0 }], data);
  assert.deepEqual(s.missing, ["NOPE"]); // ZERO (0 shares) is ignored, not "missing"
  approx(s.gross, 45000);
});

test("parsePositions: formats, shorts, dupes, comments, thousands", () => {
  const p = parsePositions(
    "AAPL 100\n# a comment\nTSLA -50\nMSFT, 60\nBRK.B 1,000\n$AAPL 25\nGARBAGE\nKO 0\n// note\naapl 5",
  );
  // AAPL appears 3× (100 + 25 + 5 = 130), $ and case tolerated; KO 0 dropped; GARBAGE ignored
  assert.deepEqual(p, [
    { symbol: "AAPL", shares: 130 },
    { symbol: "TSLA", shares: -50 },
    { symbol: "MSFT", shares: 60 },
    { symbol: "BRK.B", shares: 1000 },
  ]);
  assert.deepEqual(parsePositions(""), []);
  // a position summing to net zero is dropped
  assert.deepEqual(parsePositions("F 100\nF -100"), []);
});

test("computePortfolio: partial beta coverage is honest", () => {
  const d2 = new Map(data);
  d2.set("XYZ", { symbol: "XYZ", price: 100, sector: "Health", beta: null, ret: 1 }); // no beta
  const s = computePortfolio([...positions, { symbol: "XYZ", shares: 100 }], d2); // +$10k, no beta
  approx(s.gross, 55000);
  approx(s.betaCoverage, 45000 / 55000); // beta known for 45k of 55k gross
  approx(s.beta!, 36000 / 55000); // Σ value·beta over ALL gross (unbetaed name contributes 0)
});
