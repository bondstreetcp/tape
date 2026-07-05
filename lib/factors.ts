/**
 * Equity factor model for the Portfolio Risk Cockpit — turns a scoring universe (Russell 1000) into a
 * per-name σ score on each classic factor (Value / Quality / Momentum / Growth / Yield / Size / Low-Vol),
 * then aggregates a book's holdings into a net factor TILT (gross-signed-weighted σ, short-aware).
 *
 * Factor DEFINITIONS are aligned with the app's existing screens so a name's "value"/"quality"/"momentum"
 * means about the same thing here as on the Leaders board / ERP5 / Quality screens (lib/screens.ts, lib/leaders.ts):
 *   Value    = earnings yield (1/PE, fwd fallback) + FCF yield + book yield (1/PB)      [ERP5 value leg]
 *   Quality  = ROIC + ROE + operating margin + gross margin + Piotroski F + low leverage [~Quality screen]
 *     (uses Piotroski F where the Quality SCREEN uses FCF yield — FCF yield is already the Value leg, so
 *      reusing it here would double-count it and correlate the two factors; Piotroski F is a purpose-built
 *      earnings-quality score, which is what we want a Quality FACTOR to isolate.)
 *   Momentum = 0.1·1w + 0.2·3m + 0.3·6m + 0.4·1y return-percentiles                      [Leaders RS]
 *   Growth   = revenue growth (latest) + 3y revenue CAGR
 *   Yield    = shareholder yield + dividend yield
 *   Size     = log market cap                         (+σ = mega-cap tilt, −σ = small-cap tilt)
 *   Low-Vol  = −beta                                  (+σ = defensive/low-beta, −σ = high-beta)
 *
 * Scoring is rank-based (robust to outliers like roe=1.5): each sub-metric → its universe percentile
 * (midrank), the factor's composite = weighted mean of its sub-percentiles, then re-ranked across the
 * universe and mapped through the inverse-normal so the score reads in σ. Pure + fs-free → unit-tested
 * (tests/factors.test.ts) and reused by /api/portfolio/risk. Doctrine: code computes the stat, no LLM.
 */

export type FactorKey = "value" | "quality" | "momentum" | "growth" | "yield" | "size" | "lowvol";

export interface FactorMeta { key: FactorKey; label: string; hint: string }
export const FACTOR_META: FactorMeta[] = [
  { key: "value", label: "Value", hint: "cheap (high earnings/FCF/book yield) → +σ" },
  { key: "quality", label: "Quality", hint: "high ROIC/ROE/margins, low leverage → +σ" },
  { key: "momentum", label: "Momentum", hint: "strong trailing 1w–1y returns → +σ" },
  { key: "growth", label: "Growth", hint: "fast revenue growth (latest + 3y) → +σ" },
  { key: "yield", label: "Yield", hint: "high shareholder + dividend yield → +σ" },
  { key: "size", label: "Size", hint: "+σ = mega-cap tilt · −σ = small-cap tilt" },
  { key: "lowvol", label: "Low-Vol", hint: "+σ = defensive/low-beta · −σ = high-beta" },
];
export const FACTOR_LABEL: Record<FactorKey, string> = Object.fromEntries(FACTOR_META.map((f) => [f.key, f.label])) as Record<FactorKey, string>;

/** The raw per-name metrics the factor model consumes (units match the snapshot: margins/yields are
 *  fractions, returns are PERCENT, marketCap is USD). All optional/nullable — missing subs are skipped. */
export interface FactorInput {
  symbol: string;
  trailingPE?: number | null;
  forwardPE?: number | null;
  priceToBook?: number | null;
  dividendYield?: number | null;
  marketCap?: number | null;
  roe?: number | null;
  roic?: number | null;
  opMargin?: number | null;
  grossMargin?: number | null;
  fScore?: number | null;
  netDebtEbitda?: number | null;
  fcfYield?: number | null;
  revGrowth?: number | null;
  revCagr3y?: number | null;
  shareholderYield?: number | null;
  r1w?: number | null;
  r3m?: number | null;
  r6m?: number | null;
  r1y?: number | null;
  beta?: number | null;
}

type Sub = { get: (i: FactorInput) => number | null; w: number };

// Each factor = weighted list of sub-metrics, each already oriented so HIGHER = more of the factor.
const earningsYield = (i: FactorInput) => (i.trailingPE != null && i.trailingPE > 0 ? 1 / i.trailingPE : i.forwardPE != null && i.forwardPE > 0 ? 1 / i.forwardPE : null);
const bookYield = (i: FactorInput) => (i.priceToBook != null && i.priceToBook > 0 ? 1 / i.priceToBook : null);
const neg = (v: number | null | undefined) => (v == null ? null : -v);

const FACTOR_SUBS: Record<FactorKey, Sub[]> = {
  value: [
    { get: earningsYield, w: 1 },
    { get: (i) => i.fcfYield ?? null, w: 1 },
    { get: bookYield, w: 1 },
  ],
  quality: [
    { get: (i) => i.roic ?? null, w: 1 },
    { get: (i) => i.roe ?? null, w: 1 },
    { get: (i) => i.opMargin ?? null, w: 1 },
    { get: (i) => i.grossMargin ?? null, w: 1 },
    { get: (i) => i.fScore ?? null, w: 1 },
    { get: (i) => neg(i.netDebtEbitda), w: 1 }, // low leverage = high quality
  ],
  momentum: [
    { get: (i) => i.r1w ?? null, w: 0.1 },
    { get: (i) => i.r3m ?? null, w: 0.2 },
    { get: (i) => i.r6m ?? null, w: 0.3 },
    { get: (i) => i.r1y ?? null, w: 0.4 },
  ],
  growth: [
    { get: (i) => i.revGrowth ?? null, w: 1 },
    { get: (i) => i.revCagr3y ?? null, w: 1 },
  ],
  yield: [
    { get: (i) => i.shareholderYield ?? null, w: 1 },
    { get: (i) => i.dividendYield ?? null, w: 1 },
  ],
  size: [{ get: (i) => (i.marketCap != null && i.marketCap > 0 ? Math.log(i.marketCap) : null), w: 1 }],
  lowvol: [{ get: (i) => neg(i.beta), w: 1 }],
};

const FACTOR_KEYS = FACTOR_META.map((f) => f.key);

/** Inverse standard-normal CDF (Acklam's rational approximation, ~1e-9). p is clamped to (0,1). */
export function invNormal(p: number): number {
  const pc = Math.min(1 - 1e-9, Math.max(1e-9, p));
  const a = [-3.969683028665376e1, 2.209460984245205e2, -2.759285104469687e2, 1.38357751867269e2, -3.066479806614716e1, 2.506628277459239];
  const b = [-5.447609879822406e1, 1.615858368580409e2, -1.556989798598866e2, 6.680131188771972e1, -1.328068155288572e1];
  const c = [-7.784894002430293e-3, -3.223964580411365e-1, -2.400758277161838, -2.549732539343734, 4.374664141464968, 2.938163982698783];
  const d = [7.784695709041462e-3, 3.224671290700398e-1, 2.445134137142996, 3.754408661907416];
  const plow = 0.02425, phigh = 1 - plow;
  if (pc < plow) {
    const q = Math.sqrt(-2 * Math.log(pc));
    return (((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
  }
  if (pc <= phigh) {
    const q = pc - 0.5, r = q * q;
    return ((((((a[0] * r + a[1]) * r + a[2]) * r + a[3]) * r + a[4]) * r + a[5]) * q) / (((((b[0] * r + b[1]) * r + b[2]) * r + b[3]) * r + b[4]) * r + 1);
  }
  const q = Math.sqrt(-2 * Math.log(1 - pc));
  return -(((((c[0] * q + c[1]) * q + c[2]) * q + c[3]) * q + c[4]) * q + c[5]) / ((((d[0] * q + d[1]) * q + d[2]) * q + d[3]) * q + 1);
}

/** Midrank percentile of v within an ascending sorted array: (countLess + countEqual/2) / n, in (0,1). */
export function midrankPct(sortedAsc: number[], v: number): number {
  const n = sortedAsc.length;
  if (n === 0) return 0.5;
  // lower bound (first index >= v) and upper bound (first index > v)
  let lo = 0, hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sortedAsc[m] < v) lo = m + 1; else hi = m; }
  const lb = lo;
  lo = 0; hi = n;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sortedAsc[m] <= v) lo = m + 1; else hi = m; }
  const ub = lo;
  const countLess = lb, countEq = ub - lb;
  return (countLess + countEq / 2) / n;
}

export interface FactorModel {
  n: number;
  /** Per-name σ score for each factor (null if the name has no data for that factor). */
  score(input: FactorInput): Record<FactorKey, number | null>;
}

/**
 * Build a factor model from a scoring universe. Precomputes each sub-metric's sorted universe values +
 * each factor's universe composite distribution, so scoring any name (in or out of the universe) is a set
 * of binary searches. score() returns a σ per factor via percentile → re-rank → inverse-normal.
 */
export function buildFactorModel(universe: FactorInput[]): FactorModel {
  // Sorted universe values per (factor, sub).
  const subSorted: Record<FactorKey, number[][]> = {} as Record<FactorKey, number[][]>;
  for (const f of FACTOR_KEYS) {
    subSorted[f] = FACTOR_SUBS[f].map((sub) => {
      const vals: number[] = [];
      for (const u of universe) { const x = sub.get(u); if (x != null && Number.isFinite(x)) vals.push(x); }
      vals.sort((a, b) => a - b);
      return vals;
    });
  }

  // A name's composite for a factor = weighted mean of its available sub-percentiles (∈[0,1]), or null.
  const composite = (f: FactorKey, input: FactorInput): number | null => {
    const subs = FACTOR_SUBS[f];
    let wsum = 0, acc = 0;
    for (let k = 0; k < subs.length; k++) {
      const x = subs[k].get(input);
      if (x == null || !Number.isFinite(x)) continue;
      acc += subs[k].w * midrankPct(subSorted[f][k], x);
      wsum += subs[k].w;
    }
    return wsum > 0 ? acc / wsum : null;
  };

  // Universe composite distribution per factor (for the second-stage re-rank).
  const compSorted: Record<FactorKey, number[]> = {} as Record<FactorKey, number[]>;
  for (const f of FACTOR_KEYS) {
    const vals: number[] = [];
    for (const u of universe) { const c = composite(f, u); if (c != null) vals.push(c); }
    vals.sort((a, b) => a - b);
    compSorted[f] = vals;
  }

  return {
    n: universe.length,
    score(input: FactorInput) {
      const out = {} as Record<FactorKey, number | null>;
      for (const f of FACTOR_KEYS) {
        const c = composite(f, input);
        out[f] = c == null || compSorted[f].length === 0 ? null : invNormal(midrankPct(compSorted[f], c));
      }
      return out;
    },
  };
}

const sumAbs = (xs: number[]) => xs.reduce((a, b) => a + Math.abs(b), 0);

export interface FactorTilt { key: FactorKey; label: string; tilt: number; coverage: number }

/**
 * Net factor tilt of a book: for each factor, Σ (signedValue / gross) · score over holdings that have a
 * score for it. Shorts flip the sign (long high-momentum + short low-momentum ⇒ big +momentum tilt).
 * Denominator is FULL gross, so names missing a factor dilute toward 0 — coverage is reported alongside.
 */
export function computeFactorTilts(
  holdings: { value: number; factors?: Record<FactorKey, number | null> | null }[],
): FactorTilt[] {
  const gross = sumAbs(holdings.map((h) => h.value));
  const out: FactorTilt[] = FACTOR_KEYS.map((key) => {
    if (!gross) return { key, label: FACTOR_LABEL[key], tilt: 0, coverage: 0 };
    let tilt = 0, cov = 0;
    for (const h of holdings) {
      const z = h.factors?.[key];
      if (z == null || !Number.isFinite(z)) continue;
      tilt += (h.value / gross) * z;
      cov += Math.abs(h.value);
    }
    return { key, label: FACTOR_LABEL[key], tilt, coverage: cov / gross };
  });
  return out.sort((a, b) => Math.abs(b.tilt) - Math.abs(a.tilt));
}

export interface PairCorr { a: string; b: string; r: number }
export interface Crowding {
  avgCorr: number | null; // exposure-weighted average pairwise correlation of the book
  topPairs: PairCorr[]; // most-correlated held pairs (hidden concentration)
  nPairs: number; // pairs with usable correlation
}

/**
 * Crowding read: exposure-weighted average pairwise price correlation of the holdings (weight = |w_a|·|w_b|),
 * plus the most-correlated pairs. High avg correlation ⇒ the book's names move together (hidden concentration
 * beyond the sector view). corr holds only the held-pair correlations computed server-side off the series.
 */
export function computeCrowding(
  holdings: { symbol: string; value: number }[],
  corr: PairCorr[],
): Crowding {
  const wOf = new Map<string, number>();
  const gross = sumAbs(holdings.map((h) => h.value)) || 1;
  for (const h of holdings) wOf.set(h.symbol.toUpperCase(), Math.abs(h.value) / gross);
  let wsum = 0, acc = 0;
  for (const { a, b, r } of corr) {
    if (!Number.isFinite(r)) continue;
    const w = (wOf.get(a.toUpperCase()) ?? 0) * (wOf.get(b.toUpperCase()) ?? 0);
    if (w <= 0) continue;
    acc += w * r; wsum += w;
  }
  const topPairs = [...corr].filter((p) => Number.isFinite(p.r)).sort((x, y) => y.r - x.r).slice(0, 6);
  return { avgCorr: wsum > 0 ? acc / wsum : null, topPairs, nPairs: corr.filter((p) => Number.isFinite(p.r)).length };
}
