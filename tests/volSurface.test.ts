import { test } from "node:test";
import assert from "node:assert/strict";
import { fitQuad, fitSVI, fitSmile, type SmilePoint, type SviParams } from "../lib/volSurface";

// Synthetic slices: generate quotes FROM a known model, then check the fitter recovers the surface
// (function values, not raw params — SVI parametrizations are famously non-unique on finite strike bands).

const sviW = (p: SviParams, k: number): number => {
  const km = k - p.m;
  return p.a + p.b * (p.rho * km + Math.sqrt(km * km + p.sig * p.sig));
};

function pointsFrom(w: (k: number) => number, T: number, ks: number[], weight = 1): SmilePoint[] {
  return ks.map((k) => ({
    strike: 100 * Math.exp(k),
    moneyness: Math.exp(k) - 1,
    k,
    iv: Math.sqrt(w(k) / T),
    weight,
  }));
}

const KS = [-0.3, -0.22, -0.15, -0.1, -0.05, 0, 0.05, 0.1, 0.18, 0.25];

test("fitSVI recovers a clean synthetic SVI slice (ivAt within 0.2 vol pts across the band)", () => {
  const T = 0.25;
  const truth: SviParams = { a: 0.005, b: 0.08, rho: -0.6, m: 0.02, sig: 0.15 };
  const pts = pointsFrom((k) => sviW(truth, k), T, KS);
  const fit = fitSVI(pts, T)!;
  assert.ok(fit, "fit produced");
  for (const k of [-0.25, -0.1, 0, 0.1, 0.2]) {
    const want = Math.sqrt(sviW(truth, k) / T);
    assert.ok(Math.abs(fit.ivAt(k) - want) < 0.002, `iv at k=${k}: ${fit.ivAt(k)} vs ${want}`);
  }
  assert.ok(fit.rmse < 0.002, `rmse tiny on noiseless data (${fit.rmse})`);
  // negative rho (downside skew) must come through as negative ATM skew
  assert.ok(fit.skewPer10! < 0, "downside-skewed slice → negative skewPer10");
});

test("SVI wings extrapolate linearly in total variance (no quadratic blow-up)", () => {
  const T = 0.5;
  const truth: SviParams = { a: 0.01, b: 0.1, rho: -0.4, m: 0, sig: 0.2 };
  const pts = pointsFrom((k) => sviW(truth, k), T, KS);
  const fit = fitSVI(pts, T)!;
  // far beyond the quoted band, total variance growth per unit k must approach a CONSTANT slope
  const w = (k: number) => fit.ivAt(k) ** 2 * T;
  const slopeNear = (w(-1.0) - w(-0.8)) / 0.2;
  const slopeFar = (w(-2.0) - w(-1.8)) / 0.2;
  assert.ok(Math.abs(slopeFar - slopeNear) < 0.02, `wing slope stabilizes (${slopeNear} → ${slopeFar})`);
  assert.ok(slopeFar <= 0.4 + 1e-9, "left wing slope respects the b(1+|ρ|) ≤ 2 style bound");
});

test("fitQuad recovers a parabola-shaped smile and flags the one rich outlier", () => {
  const T = 0.25;
  const w = (k: number) => 0.04 * T + 0.02 * T * k + 0.5 * T * k * k;
  const pts = pointsFrom(w, T, KS);
  pts[3] = { ...pts[3], iv: pts[3].iv + 0.05 }; // one strike quoted 5 vol pts rich
  const fit = fitQuad(pts, T)!;
  assert.ok(fit, "fit produced");
  const rich = fit.strikes[3];
  assert.ok(rich.residual > 0.03, `outlier reads rich (${rich.residual})`);
  // Huber pass: the other strikes' residuals stay small despite the outlier
  const others = fit.strikes.filter((_, i) => i !== 3).map((s) => Math.abs(s.residual));
  assert.ok(Math.max(...others) < 0.01, `clean strikes unpolluted (max ${Math.max(...others)})`);
});

test("fitSmile prefers SVI on a true-SVI slice and falls back to quadratic when SVI is unavailable", () => {
  const T = 0.25;
  const truth: SviParams = { a: 0.005, b: 0.09, rho: -0.5, m: 0.01, sig: 0.12 };
  const sviPts = pointsFrom((k) => sviW(truth, k), T, KS);
  const smile = fitSmile(sviPts, T)!;
  // dispatcher keeps whichever fits better — on a true-SVI slice that must be (near-)SVI quality
  assert.ok(smile.rmse < 0.002, `dispatched fit is tight on SVI truth (${smile.rmse})`);
  // 3 points: below SVI's minimum (4) but enough for the quadratic — dispatcher must still return a fit
  const three = pointsFrom((k) => 0.04 * T + 0.4 * T * k * k, T, [-0.1, 0, 0.1]);
  const fallback = fitSmile(three, T)!;
  assert.ok(fallback, "3-point slice still fits via quadratic fallback");
  assert.ok(Math.abs(fallback.ivAt(0) - 0.2) < 0.01, "fallback ATM vol correct");
});

test("degenerate inputs return null, never throw", () => {
  const T = 0.25;
  assert.equal(fitSVI([], T), null);
  assert.equal(fitQuad([], T), null);
  assert.equal(fitSmile([], T), null);
  const pts = pointsFrom((k) => 0.04 * T + 0.4 * T * k * k, T, KS);
  assert.equal(fitSmile(pts, 0), null); // T = 0
  const junk = pts.map((p) => ({ ...p, iv: 0 })); // all-zero IVs filtered out
  assert.equal(fitSmile(junk, T), null);
});
