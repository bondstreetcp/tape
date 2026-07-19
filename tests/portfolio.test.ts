import { test } from "node:test";
import assert from "node:assert/strict";
import { computePortfolio, scenarioPnL, parsePositions, mergePositions, type NameData, type Position } from "../lib/portfolio";

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

test("computePortfolio: exposures as % of AUM incl. beta-adjusted", () => {
  const s = computePortfolio(positions, data, 50000); // account equity $50k
  approx(s.aum!, 50000);
  approx(s.betaDollar!, 36000); // Σ value·β = 24000 + 22000 − 10000
  approx(s.exposurePct!.gross, 45000 / 50000); // 0.90
  approx(s.exposurePct!.net, 35000 / 50000); // 0.70
  approx(s.exposurePct!.long, 40000 / 50000); // 0.80
  approx(s.exposurePct!.short, -5000 / 50000); // −0.10
  approx(s.exposurePct!.betaAdj!, 36000 / 50000); // beta-adjusted net / aum = 0.72
});

test("computePortfolio: no/invalid AUM → exposurePct null, backward-compatible", () => {
  const a = computePortfolio(positions, data); // aum omitted (old 2-arg call)
  assert.equal(a.aum, null);
  assert.equal(a.exposurePct, null);
  approx(a.betaDollar!, 36000); // betaDollar is AUM-independent, still computed
  for (const bad of [0, -100, NaN, Infinity]) {
    const s = computePortfolio(positions, data, bad);
    assert.equal(s.aum, null, `aum ${bad}`);
    assert.equal(s.exposurePct, null, `exposurePct ${bad}`);
  }
});

test("computePortfolio: betaAdj null when the book has no betas", () => {
  const noBeta = new Map<string, NameData>([["A", { symbol: "A", price: 10, beta: null }]]);
  const s = computePortfolio([{ symbol: "A", shares: 100 }], noBeta, 5000); // +$1k, no beta
  assert.equal(s.betaDollar, null);
  assert.equal(s.exposurePct!.betaAdj, null); // AUM set, but no beta → beta-adjusted % is null
  approx(s.exposurePct!.gross, 1000 / 5000); // dollar exposures still divide by AUM
});

test("mergePositions: sum deltas, drop net-zero, add new names (what-if)", () => {
  const base: Position[] = [{ symbol: "AAPL", shares: 100 }, { symbol: "MSFT", shares: 50 }, { symbol: "F", shares: 100 }];
  const after = mergePositions(base, [
    { symbol: "AAPL", shares: 50 }, // add to a holding → 150
    { symbol: "F", shares: -100 }, // close it → dropped
    { symbol: "NVDA", shares: -20 }, // brand-new short
  ]);
  assert.deepEqual(after, [
    { symbol: "AAPL", shares: 150 },
    { symbol: "MSFT", shares: 50 },
    { symbol: "NVDA", shares: -20 },
  ]);
  assert.deepEqual(mergePositions(base, []), base); // no-op delta
});

test("computePortfolio: partial beta coverage is honest", () => {
  const d2 = new Map(data);
  d2.set("XYZ", { symbol: "XYZ", price: 100, sector: "Health", beta: null, ret: 1 }); // no beta
  const s = computePortfolio([...positions, { symbol: "XYZ", shares: 100 }], d2); // +$10k, no beta
  approx(s.gross, 55000);
  approx(s.betaCoverage, 45000 / 55000); // beta known for 45k of 55k gross
  approx(s.beta!, 36000 / 55000); // Σ value·beta over ALL gross (unbetaed name contributes 0)
});
