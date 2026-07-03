import { test } from "node:test";
import assert from "node:assert/strict";
import { normCdf, bsPrice, straddlePrice, ivFromPrice, straddleIvFromPrice } from "../lib/blackScholes";

const near = (a: number, b: number, eps = 1e-3) => assert.ok(Math.abs(a - b) <= eps, `${a} ≈ ${b} (±${eps})`);

// normCdf — the pricer's only transcendental; a bad approximation poisons every option value.
test("normCdf: known points and symmetry", () => {
  near(normCdf(0), 0.5, 1e-6);
  near(normCdf(1.96), 0.975, 1e-3); // the 97.5th percentile
  near(normCdf(-1.96), 0.025, 1e-3);
  near(normCdf(1.2) + normCdf(-1.2), 1, 1e-6); // N(x)+N(-x)=1
});

// At/after expiry or zero vol, an option is worth exactly its intrinsic value.
test("bsPrice: collapses to intrinsic at T<=0", () => {
  assert.equal(bsPrice("call", 110, 100, 0, 0.3), 10);
  assert.equal(bsPrice("call", 90, 100, 0, 0.3), 0);
  assert.equal(bsPrice("put", 90, 100, 0, 0.3), 10);
  assert.equal(bsPrice("put", 110, 100, 0, 0.3), 0);
});
test("bsPrice: collapses to intrinsic at zero vol", () => {
  assert.equal(bsPrice("call", 110, 100, 1, 0), 10);
  assert.equal(bsPrice("put", 90, 100, 1, 0), 10);
});

// Put–call parity is the load-bearing identity: C − P = S − K·e^(−rT). If it holds across regimes the
// call and put formulas are mutually consistent.
test("bsPrice: satisfies put-call parity", () => {
  for (const [S, K, T, sig, r] of [[100, 100, 0.5, 0.3, 0.04], [120, 100, 1, 0.25, 0.02], [80, 100, 0.25, 0.6, 0.05]]) {
    const c = bsPrice("call", S, K, T, sig, r), p = bsPrice("put", S, K, T, sig, r);
    near(c - p, S - K * Math.exp(-r * T), 1e-6);
  }
});

// A pinned analytic value (r=0 ATM) guards against a gross formula regression the parity test can't see.
test("bsPrice: matches the closed-form ATM value (r=0)", () => {
  // S=K=100, T=1, σ=0.2, r=0 → C = 100·(N(0.1)−N(−0.1)) ≈ 7.9656
  near(bsPrice("call", 100, 100, 1, 0.2, 0), 7.9656, 5e-3);
});

test("bsPrice: monotonic in volatility (more vol → more premium)", () => {
  const lo = bsPrice("call", 100, 100, 0.5, 0.2), hi = bsPrice("call", 100, 100, 0.5, 0.6);
  assert.ok(hi > lo);
});

test("straddlePrice: equals the call + put legs", () => {
  const S = 100, K = 100, T = 0.4, sig = 0.35, r = 0.04;
  near(straddlePrice(S, K, T, sig, r), bsPrice("call", S, K, T, sig, r) + bsPrice("put", S, K, T, sig, r), 1e-9);
});

// IV solved from a premium must round-trip back to the vol that produced the premium — this is the
// anchor the earnings IV-crush scenario tool relies on.
test("ivFromPrice: round-trips the volatility", () => {
  const S = 100, K = 105, T = 0.5, r = 0.04, sig = 0.42;
  const price = bsPrice("call", S, K, T, sig, r);
  const iv = ivFromPrice("call", S, K, T, price, r);
  assert.ok(iv != null);
  near(iv!, sig, 1e-3);
});
test("ivFromPrice: null when un-invertible", () => {
  assert.equal(ivFromPrice("call", 100, 100, 0.5, 0), null); // price <= 0
  assert.equal(ivFromPrice("call", 100, 100, 0, 5), null); // expired
});
test("ivFromPrice: intrinsic-only premium implies ~zero vol", () => {
  const S = 150, K = 100, T = 0.5, r = 0.04;
  const intrinsic = S - K * Math.exp(-r * T);
  const iv = ivFromPrice("call", S, K, T, intrinsic, r);
  assert.ok(iv != null && iv <= 1e-3);
});

test("straddleIvFromPrice: round-trips the volatility", () => {
  const S = 100, K = 100, T = 0.3, r = 0.04, sig = 0.5;
  const price = straddlePrice(S, K, T, sig, r);
  const iv = straddleIvFromPrice(S, K, T, price, r);
  assert.ok(iv != null);
  near(iv!, sig, 1e-3);
});
