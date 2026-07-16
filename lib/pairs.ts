/**
 * Pairs / relative-value stat-arb math. For two price series we fit a hedge ratio, form the log-price
 * spread, and measure (a) how STRETCHED it is right now (z-score of the spread) and (b) how fast it
 * mean-reverts (Ornstein-Uhlenbeck half-life, à la Chan) — the two things that make a pair tradeable.
 *
 * Pure + fs-free so it's unit-tested (tests/pairs.test.ts) and reusable in the nightly + any route.
 * Series are the app's stored daily tuples: [timestampMs, price][]. Doctrine: code computes the stat.
 */

export type Daily = [number, number][]; // [tsMs, price]

export interface Pair {
  a: string;
  b: string;
  sector: string;
  beta: number; // hedge ratio: logA ≈ α + beta·logB (units of A per unit of B, in log space)
  corr: number; // correlation of daily log returns (pair-quality pre-filter)
  z: number; // current spread z-score — how many σ the spread sits from its mean (sign: >0 = A rich vs B)
  halfLifeDays: number | null; // OU mean-reversion half-life; null if not mean-reverting
  n: number; // overlapping observations used
  lastSpread: number;
  meanSpread: number;
  sdSpread: number;
}

/** A screener row = a Pair enriched with display fields (names + last prices), written to data/pairs.json. */
export interface PairRow extends Pair {
  nameA: string;
  nameB: string;
  priceA: number | null;
  priceB: number | null;
}
/**
 * A DECOUPLED pair: two same-sector names that moved together over the long window (high corrLong)
 * but whose recent return-correlation collapsed (low corrShort). The relationship BROKE — usually a
 * single-name catalyst on one leg (guidance, M&A, a downgrade, an idiosyncratic shock). Distinct from
 * a "stretched" pair (a wide-but-still-mean-reverting spread): here the co-movement itself is failing.
 */
export interface Decoupled {
  a: string;
  b: string;
  sector: string;
  corrLong: number; // return correlation over the long window — how tightly they USED to move
  corrShort: number; // return correlation over the recent window — how tightly they move NOW
  drop: number; // corrLong − corrShort (the size of the break)
  z: number; // current spread z (long-window hedge) — context only; 0 when no valid level hedge
  beta: number; // long-window hedge ratio (0 when levels diverged past a clean hedge)
  n: number; // overlapping observations
  broke: string; // the leg that actually MOVED most over the recent window — the likely catalyst name
  brokeMovePct: number; // that leg's cumulative % move over the recent window (signed — direction matters)
}
export interface DecoupledRow extends Decoupled {
  nameA: string;
  nameB: string;
  priceA: number | null;
  priceB: number | null;
}

export interface PairsData {
  generatedAt: string;
  universe: string;
  scanned: number;
  pairs: PairRow[];
  decoupled?: DecoupledRow[]; // optional so pre-expansion files still parse
}

const mean = (x: number[]): number => (x.length ? x.reduce((a, b) => a + b, 0) / x.length : 0);

function std(x: number[]): number {
  const n = x.length;
  if (n < 2) return 0;
  const m = mean(x);
  return Math.sqrt(x.reduce((s, v) => s + (v - m) * (v - m), 0) / (n - 1));
}

/** OLS slope + intercept of y on x (least squares). Returns {slope:0,intercept:mean(y)} if x is constant. */
export function ols(x: number[], y: number[]): { slope: number; intercept: number } {
  const n = Math.min(x.length, y.length);
  if (n < 2) return { slope: 0, intercept: n ? y[0] : 0 };
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
  let sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sxx += (x[i] - mx) * (x[i] - mx);
    sxy += (x[i] - mx) * (y[i] - my);
  }
  const slope = sxx === 0 ? 0 : sxy / sxx;
  return { slope, intercept: my - slope * mx };
}

/** Correlation of two equal-length arrays (Pearson). 0 if either is constant. */
export function correlation(x: number[], y: number[]): number {
  const n = Math.min(x.length, y.length);
  if (n < 2) return 0;
  const mx = mean(x.slice(0, n)), my = mean(y.slice(0, n));
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - mx, dy = y[i] - my;
    sxy += dx * dy; sxx += dx * dx; syy += dy * dy;
  }
  return sxx === 0 || syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy);
}

/** Hedge ratio β from regressing logA on logB (spread = logA − β·logB). */
export const hedgeRatio = (logA: number[], logB: number[]): number => ols(logB, logA).slope;

/** The log-price spread series given a hedge ratio. */
export const spreadSeries = (logA: number[], logB: number[], beta: number): number[] =>
  logA.map((a, i) => a - beta * logB[i]);

/** Current spread z-score = (last − mean) / sd. 0 if degenerate. */
export function zScore(spread: number[]): number {
  const sd = std(spread);
  return sd === 0 ? 0 : (spread[spread.length - 1] - mean(spread)) / sd;
}

/**
 * Ornstein-Uhlenbeck mean-reversion half-life (in observations): regress Δspread_t on the lagged level
 * spread_{t-1}; the slope λ<0 means reversion, half-life = −ln(2)/λ. Returns null if the spread isn't
 * mean-reverting (λ≥0) or there's too little data. (Chan, "Algorithmic Trading".)
 */
export function halfLife(spread: number[]): number | null {
  if (spread.length < 20) return null;
  const dy: number[] = [], lag: number[] = [];
  for (let i = 1; i < spread.length; i++) { dy.push(spread[i] - spread[i - 1]); lag.push(spread[i - 1]); }
  const { slope } = ols(lag, dy);
  if (!(slope < 0) || !Number.isFinite(slope)) return null;
  const hl = -Math.log(2) / slope;
  return Number.isFinite(hl) && hl > 0 ? hl : null;
}

const DAY_MS = 86_400_000;
/** Collapse a [ts,price] series to one point per calendar day (last close wins), sorted ascending. The
 *  stored series carry intraday timestamps, so two names rarely share an exact ts — bucket before aligning. */
export function bucketByDay(d: Daily): Daily {
  const m = new Map<number, number>();
  for (const [t, p] of d) if (p > 0) m.set(Math.floor(t / DAY_MS) * DAY_MS, p);
  return [...m.entries()].sort((a, b) => a[0] - b[0]);
}

/** Correlation of two names' daily log-returns over their shared history. Day-buckets both series first
 *  (else intraday-timestamp mismatch yields ~zero overlap). null if fewer than `minOverlap` shared days. */
export function corrOf(a: Daily, b: Daily, minOverlap = 120): number | null {
  const { logA, logB } = alignLogPrices(bucketByDay(a), bucketByDay(b));
  const n = Math.min(logA.length, logB.length);
  if (n < minOverlap) return null;
  const rA: number[] = [], rB: number[] = [];
  for (let i = 1; i < n; i++) { rA.push(logA[i] - logA[i - 1]); rB.push(logB[i] - logB[i - 1]); }
  const c = correlation(rA, rB);
  return Number.isFinite(c) ? c : null;
}

/** Align two daily [ts,px] series on shared timestamps (positive prices only) → parallel log-price arrays. */
export function alignLogPrices(a: Daily, b: Daily): { logA: number[]; logB: number[] } {
  const mb = new Map<number, number>();
  for (const [t, p] of b) if (p > 0) mb.set(t, p);
  const pairsTP: [number, number, number][] = [];
  for (const [t, p] of a) {
    const q = mb.get(t);
    if (p > 0 && q != null && q > 0) pairsTP.push([t, p, q]);
  }
  pairsTP.sort((x, y) => x[0] - y[0]);
  return { logA: pairsTP.map((x) => Math.log(x[1])), logB: pairsTP.map((x) => Math.log(x[2])) };
}

/** Market beta = slope of the name's daily log-returns regressed on the market's, over the aligned
 *  trailing window (default ~2y). null if too little overlapping history. */
export function computeBeta(name: Daily, market: Daily, lookback = 504): number | null {
  const { logA, logB } = alignLogPrices(name, market); // A = name, B = market
  const n = Math.min(logA.length, logB.length);
  if (n < 60) return null;
  const s = Math.max(0, n - lookback);
  const rName: number[] = [], rMkt: number[] = [];
  for (let i = s + 1; i < n; i++) { rName.push(logA[i] - logA[i - 1]); rMkt.push(logB[i] - logB[i - 1]); }
  if (rMkt.length < 40) return null;
  const b = ols(rMkt, rName).slope;
  return Number.isFinite(b) ? b : null;
}

export interface PairOpts {
  lookback?: number; // trailing observations for the spread stats (default 252 ≈ 1y)
  minOverlap?: number; // min shared obs to consider a pair (default 120)
  minCorr?: number; // min return correlation (default 0.7)
  minAbsZ?: number; // min |z| to flag as stretched (default 2)
  minHalfLife?: number; // days (default 2)
  maxHalfLife?: number; // days (default 60)
  maxPerSector?: number; // cap names per sector to bound the O(n²) scan (default 30)
  topN?: number; // cap the output (default 60)
}

/** Compute one pair's stats from two aligned log-price arrays over the trailing `lookback` window. */
export function evalPair(a: string, b: string, sector: string, logA: number[], logB: number[], lookback: number): Pair | null {
  const n = Math.min(logA.length, logB.length);
  if (n < 30) return null;
  const s = Math.max(0, n - lookback);
  const la = logA.slice(s), lb = logB.slice(s);
  const beta = hedgeRatio(la, lb);
  if (!Number.isFinite(beta) || beta <= 0) return null; // negative/zero hedge = not a clean long-short pair
  const spread = spreadSeries(la, lb, beta);
  const retA: number[] = [], retB: number[] = [];
  for (let i = 1; i < la.length; i++) { retA.push(la[i] - la[i - 1]); retB.push(lb[i] - lb[i - 1]); }
  return {
    a, b, sector, beta,
    corr: correlation(retA, retB),
    z: zScore(spread),
    halfLifeDays: halfLife(spread),
    n: la.length,
    lastSpread: spread[spread.length - 1],
    meanSpread: mean(spread),
    sdSpread: std(spread),
  };
}

/**
 * Scan all same-sector pairs among `names` (capped per sector) and return the tradeable, STRETCHED ones —
 * correlated, mean-reverting within [minHalfLife, maxHalfLife] days, |z| ≥ minAbsZ — ranked by |z| desc.
 */
export function findPairs(
  names: string[],
  series: Map<string, Daily>,
  sectorOf: (s: string) => string,
  rankOf: (s: string) => number, // e.g. market cap — to pick the most-liquid names per sector
  opts: PairOpts = {},
): Pair[] {
  const { lookback = 252, minOverlap = 120, minCorr = 0.7, minAbsZ = 2, minHalfLife = 2, maxHalfLife = 60, maxPerSector = 30, topN = 60 } = opts;
  const bySector = new Map<string, string[]>();
  for (const s of names) {
    if (!series.has(s)) continue;
    const sec = sectorOf(s) || "—";
    (bySector.get(sec) ?? bySector.set(sec, []).get(sec)!).push(s);
  }
  const out: Pair[] = [];
  for (const [sec, syms] of bySector) {
    const pool = syms.sort((x, y) => (rankOf(y) || 0) - (rankOf(x) || 0)).slice(0, maxPerSector);
    for (let i = 0; i < pool.length; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        const { logA, logB } = alignLogPrices(series.get(pool[i])!, series.get(pool[j])!);
        if (logA.length < minOverlap) continue;
        const p = evalPair(pool[i], pool[j], sec, logA, logB, lookback);
        if (!p) continue;
        if (p.corr < minCorr) continue;
        if (p.halfLifeDays == null || p.halfLifeDays < minHalfLife || p.halfLifeDays > maxHalfLife) continue;
        if (Math.abs(p.z) < minAbsZ) continue;
        out.push(p);
      }
    }
  }
  return out.sort((x, y) => Math.abs(y.z) - Math.abs(x.z)).slice(0, topN);
}

export interface ScanOpts extends PairOpts {
  shortWin?: number; // recent window (obs) for the decoupling break (default 21 ≈ 1 month)
  minLongCorr?: number; // decoupling: the pair must have been at least this correlated long-run (default 0.6)
  minDrop?: number; // decoupling: corrLong − corrShort to count as a break (default 0.45)
  maxShortCorr?: number; // decoupling: recent corr must have fallen below this (default 0.35)
  decoupledTopN?: number; // cap the decoupled list (default 60)
  deadlineMs?: number; // wall-clock stop (Date.now() > deadlineMs → stop scanning) for the slow box
}

/**
 * Universe-wide same-sector scan that computes BOTH signals from ONE alignment per pair — the
 * efficient shape for the NAS (weak CPU, big RAM): all series resident, one pass. Returns the
 * STRETCHED pairs (wide but mean-reverting — a convergence trade) and the DECOUPLED pairs (were
 * tightly correlated, just broke — a catalyst tell). Same sector-bucket + per-sector liquidity cap
 * as findPairs; honors a wall-clock `deadlineMs` so a heavy universe can't blow the step budget.
 */
export function scanPairs(
  names: string[],
  series: Map<string, Daily>,
  sectorOf: (s: string) => string,
  rankOf: (s: string) => number,
  opts: ScanOpts = {},
): { stretched: Pair[]; decoupled: Decoupled[]; pairsTested: number; truncated: boolean } {
  const {
    lookback = 252, minOverlap = 120, minCorr = 0.7, minAbsZ = 2, minHalfLife = 2, maxHalfLife = 60,
    maxPerSector = 120, topN = 120,
    shortWin = 21, minLongCorr = 0.55, minDrop = 0.35, maxShortCorr = 0.45, decoupledTopN = 60,
    deadlineMs,
  } = opts;

  const bySector = new Map<string, string[]>();
  for (const s of names) {
    if (!series.has(s)) continue;
    const sec = sectorOf(s) || "—";
    (bySector.get(sec) ?? bySector.set(sec, []).get(sec)!).push(s);
  }

  const stretched: Pair[] = [];
  const decoupled: Decoupled[] = [];
  let pairsTested = 0, truncated = false;

  for (const [sec, syms] of bySector) {
    const pool = syms.sort((x, y) => (rankOf(y) || 0) - (rankOf(x) || 0)).slice(0, maxPerSector);
    for (let i = 0; i < pool.length && !truncated; i++) {
      for (let j = i + 1; j < pool.length; j++) {
        // Cheap deadline check every 4096 pairs — the scan is a tight synchronous loop.
        if (deadlineMs && (pairsTested & 4095) === 0 && Date.now() > deadlineMs) { truncated = true; break; }
        const { logA, logB } = alignLogPrices(series.get(pool[i])!, series.get(pool[j])!);
        if (logA.length < minOverlap) continue;
        pairsTested++;

        // Trailing window shared by both signals.
        const n = logA.length;
        const s = Math.max(0, n - lookback);
        const la = logA.slice(s), lb = logB.slice(s);
        const retA: number[] = [], retB: number[] = [];
        for (let k = 1; k < la.length; k++) { retA.push(la[k] - la[k - 1]); retB.push(lb[k] - lb[k - 1]); }
        if (retA.length < 20) continue;
        const corrLong = correlation(retA, retB);
        // The level hedge is needed for the STRETCHED spread, but NOT for decoupling (a returns-space
        // phenomenon): a pair whose prices diverged past a clean hedge (β≤0) can still be a real break.
        const beta = hedgeRatio(la, lb);
        const validBeta = Number.isFinite(beta) && beta > 0;
        const spread = validBeta ? spreadSeries(la, lb, beta) : null;
        const z = spread ? zScore(spread) : 0;

        // (1) DECOUPLED takes PRECEDENCE — a broken relationship is NOT a convergence trade, so a
        // pair classified here is excluded from the stretched list (they'd give opposite advice).
        let isDecoupled = false;
        if (retA.length >= shortWin && corrLong >= minLongCorr) {
          const rAs = retA.slice(-shortWin), rBs = retB.slice(-shortWin);
          // ⚠ A flat/frozen recent window (a halted/delisted leg carried forward) makes corr ~0
          // artificially — not a real break. Require genuine recent variance in BOTH legs.
          if (std(rAs) > 1e-6 && std(rBs) > 1e-6) {
            const corrShort = correlation(rAs, rBs);
            if (corrLong - corrShort >= minDrop && corrShort <= maxShortCorr) {
              // Attribute the break to the leg that actually MOVED most over the window (direction
              // and magnitude), NOT the spread sign — the spread sign only says which is currently
              // rich, so it names the wrong leg whenever the catalyst leg fell (the move-attribution trap).
              const moveA = rAs.reduce((t, r) => t + r, 0), moveB = rBs.reduce((t, r) => t + r, 0);
              const bigA = Math.abs(moveA) >= Math.abs(moveB);
              decoupled.push({
                a: pool[i], b: pool[j], sector: sec, corrLong, corrShort, drop: corrLong - corrShort,
                z, beta: validBeta ? beta : 0, n: la.length,
                broke: bigA ? pool[i] : pool[j],
                brokeMovePct: +(((Math.exp(bigA ? moveA : moveB) - 1) * 100).toFixed(1)),
              });
              isDecoupled = true;
            }
          }
        }

        // (2) STRETCHED — the classic convergence pair. Skipped for a decoupled pair (mutual-exclusion).
        if (!isDecoupled && validBeta && spread && corrLong >= minCorr) {
          const hl = halfLife(spread);
          if (hl != null && hl >= minHalfLife && hl <= maxHalfLife && Math.abs(z) >= minAbsZ) {
            stretched.push({ a: pool[i], b: pool[j], sector: sec, beta, corr: corrLong, z, halfLifeDays: hl, n: la.length, lastSpread: spread[spread.length - 1], meanSpread: mean(spread), sdSpread: std(spread) });
          }
        }
      }
    }
  }

  return {
    stretched: stretched.sort((x, y) => Math.abs(y.z) - Math.abs(x.z)).slice(0, topN),
    decoupled: decoupled.sort((x, y) => y.drop - x.drop).slice(0, decoupledTopN),
    pairsTested,
    truncated,
  };
}
