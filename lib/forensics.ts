/**
 * Fundamental forensics — earnings-quality / red-flag scores computed from the cached quarterly
 * fundamentals panel (data/valuation-panel.json), PURE + fs-free so it's unit-tested and needs NO
 * network. Doctrine: code computes the stat; a missing input yields a NULL score for that name, never
 * a wrong line. Four canonical models, each on a trailing-twelve-month (TTM) basis, current year (t)
 * vs one year prior (t-1):
 *
 *   • Beneish M-score  (Beneish 1999, "The Detection of Earnings Manipulation", 8-variable model)
 *   • Altman Z-score   (Altman 1968, original public-manufacturer model) — bankruptcy/distress
 *   • Piotroski F-score (Piotroski 2000, "Value Investing…", 9 binary signals) — fundamental strength
 *   • Sloan accruals    (Sloan 1996, the accruals anomaly) — earnings backed by cash vs accruals
 *
 * All are DESIGNED for non-financial operating companies; banks/insurers lack the balance-sheet lines
 * (current ratio, gross margin, EBIT/turnover) and are returned null for the affected scores.
 */

const num = (x: unknown): number | null => (typeof x === "number" && Number.isFinite(x) ? x : null);
const pos = (x: number | null): number | null => (x != null && x > 0 ? x : null); // strictly-positive-or-null (for denominators)
const DAY = 86_400_000;
const spanDays = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / DAY);

/** One quarter from the panel — the fields forensics reads (superset of what any single score needs). */
export interface PQ {
  d: string;
  rev?: number; ni?: number; oi?: number; da?: number; ltd?: number; eq?: number; shs?: number;
  cfo?: number; gp?: number; sga?: number; ta?: number; ca?: number; cl?: number; tl?: number; re?: number; rec?: number; ppe?: number;
}

/** A fiscal-year (TTM) snapshot assembled from four contiguous quarters. Flows are TTM sums; the rest
 *  are the period-end (or year-ago) balance-sheet instants. Any field is null when an input is absent. */
export interface Annual {
  end: string;
  // TTM flows (sum of the 4 quarters)
  sales: number | null; ni: number | null; cfo: number | null; ebit: number | null; dep: number | null; sga: number | null; gp: number | null;
  // period-end instants
  ta: number | null; ca: number | null; cl: number | null; tl: number | null; re: number | null; ltd: number | null; rec: number | null; ppe: number | null; shares: number | null;
  // one-year-earlier total assets (for average-total-assets denominators)
  taBegin: number | null;
}

/** Drop near-duplicate quarter-ends (<25 days apart) keeping the later — same guard the panel builder
 *  uses; the panel stores raw edgarQuarterly output which can carry an amended re-statement of one end. */
export function dedupeQuarters(q: PQ[]): PQ[] {
  const sorted = [...q].sort((a, b) => a.d.localeCompare(b.d));
  const out: PQ[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(spanDays(prev.d, p.d)) < 25) out[out.length - 1] = p; // keep the later
    else out.push(p);
  }
  return out;
}

/** TTM sum of a flow field over quarters[i-3..i] — null unless all 4 present AND the window spans a
 *  year (270-460d), so a gap in the quarterly panel can't silently produce a partial-year "annual". */
function ttm(q: PQ[], i: number, f: keyof PQ): number | null {
  if (i < 3) return null;
  const w = [q[i - 3], q[i - 2], q[i - 1], q[i]];
  const s = spanDays(w[0].d, w[3].d);
  if (s < 270 || s > 460) return null;
  let sum = 0;
  for (const p of w) { const v = num(p[f]); if (v == null) return null; sum += v; }
  return sum;
}

/** Assemble the TTM/period-end annual snapshot whose fiscal year ENDS at quarter index `i`. */
export function assembleAnnual(q: PQ[], i: number): Annual | null {
  if (i < 3 || i >= q.length) return null;
  const end = q[i];
  const inst = (f: keyof PQ): number | null => num(end[f]);
  return {
    end: end.d,
    sales: ttm(q, i, "rev"), ni: ttm(q, i, "ni"), cfo: ttm(q, i, "cfo"), ebit: ttm(q, i, "oi"),
    dep: ttm(q, i, "da"), sga: ttm(q, i, "sga"), gp: ttm(q, i, "gp"),
    ta: inst("ta"), ca: inst("ca"), cl: inst("cl"), tl: inst("tl"), re: inst("re"), ltd: inst("ltd"),
    rec: inst("rec"), ppe: inst("ppe"), shares: inst("shs"),
    // year-ago total assets for average-total-assets denominators — only when index −4 is actually
    // ~1yr back; a panel gap there must not average assets across multiple years.
    taBegin: i >= 4 && spanDays(q[i - 4].d, end.d) >= 270 && spanDays(q[i - 4].d, end.d) <= 460 ? num(q[i - 4].ta) : null,
  };
}

// ── Sloan accruals ratio (Sloan 1996) ─────────────────────────────────────────────────────────────
// accruals = (Net Income − Cash Flow from Operations) / average Total Assets. HIGH positive accruals
// = earnings propped up by accruals rather than cash → lower quality, historically mean-reverting and
// associated with future underperformance. Returned as a fraction (×100 for %).
export function sloanAccruals(t: Annual): number | null {
  const avgTA = t.ta != null && t.taBegin != null ? (t.ta + t.taBegin) / 2 : t.ta;
  if (t.ni == null || t.cfo == null || avgTA == null || avgTA <= 0) return null;
  return (t.ni - t.cfo) / avgTA;
}

// ── Piotroski F-score (Piotroski 2000) — 9 binary signals, current FY vs prior FY ─────────────────
// Ending total assets used consistently for ROA/turnover (a common, well-defined implementation; the
// discriminating power is in the 9 Δ signals, robust to the begin/avg/end choice). Null unless every
// input is present — a partial count is not the F-score (financials legitimately return null).
export function piotroskiF(t: Annual, p: Annual): number | null {
  const need = [t.ni, t.ta, t.cfo, t.ltd, t.ca, t.cl, t.shares, t.gp, t.sales, p.ni, p.ta, p.ltd, p.ca, p.cl, p.shares, p.gp, p.sales];
  if (need.some((x) => x == null)) return null;
  if ((t.ta as number) <= 0 || (p.ta as number) <= 0 || (t.cl as number) <= 0 || (p.cl as number) <= 0 || (t.sales as number) <= 0 || (p.sales as number) <= 0) return null;
  const roaT = (t.ni as number) / (t.ta as number), roaP = (p.ni as number) / (p.ta as number);
  let f = 0;
  if (roaT > 0) f++;                                                    // 1 profitable (ROA)
  if ((t.cfo as number) > 0) f++;                                       // 2 positive operating cash flow
  if (roaT > roaP) f++;                                                 // 3 rising ROA
  if ((t.cfo as number) / (t.ta as number) > roaT) f++;                 // 4 CFO > NI (accrual quality)
  if ((t.ltd as number) / (t.ta as number) < (p.ltd as number) / (p.ta as number)) f++; // 5 falling leverage
  if ((t.ca as number) / (t.cl as number) > (p.ca as number) / (p.cl as number)) f++;   // 6 rising current ratio
  if ((t.shares as number) <= (p.shares as number)) f++;                // 7 no net dilution
  if ((t.gp as number) / (t.sales as number) > (p.gp as number) / (p.sales as number)) f++; // 8 rising gross margin
  if ((t.sales as number) / (t.ta as number) > (p.sales as number) / (p.ta as number)) f++;  // 9 rising asset turnover
  return f;
}

// ── Altman Z-score (Altman 1968, original public-manufacturer model) ──────────────────────────────
// Z = 1.2·X1 + 1.4·X2 + 3.3·X3 + 0.6·X4 + 1.0·X5. Zones: >2.99 safe · 1.81–2.99 grey · <1.81 distress.
// ⚠ Calibrated on MANUFACTURERS; X5 (asset turnover) penalizes asset-light names, so it reads low for
// software/services — surfaced as a caveat in the UI. NOT applicable to financials → null there.
export function altmanZ(t: Annual, marketCapUsd: number | null, isFinancial: boolean): number | null {
  if (isFinancial) return null;
  const { ta, ca, cl, re, ebit, tl, sales } = t;
  if (ta == null || ta <= 0 || tl == null || tl <= 0 || ca == null || cl == null || re == null || ebit == null || sales == null || marketCapUsd == null || marketCapUsd <= 0) return null;
  const x1 = (ca - cl) / ta, x2 = re / ta, x3 = ebit / ta, x4 = marketCapUsd / tl, x5 = sales / ta;
  return 1.2 * x1 + 1.4 * x2 + 3.3 * x3 + 0.6 * x4 + 1.0 * x5;
}

// ── Beneish M-score (Beneish 1999) — 8-variable earnings-manipulation model ───────────────────────
// M = −4.84 + 0.920·DSRI + 0.528·GMI + 0.404·AQI + 0.892·SGI + 0.115·DEPI − 0.172·SGAI + 4.679·TATA
//     − 0.327·LVGI. Higher M ⇒ more manipulation-like. Threshold (Wikipedia/Beneish): M > −2.22 ⇒
// likely manipulator; M > −1.78 is a stronger signal. TATA uses the income-statement accruals proxy
// (NI − CFO)/TA — the standard modern implementation, equivalent to the balance-sheet definition.
export function beneishM(t: Annual, p: Annual): number | null {
  // GM (gross margin) from gross profit; AQ (asset quality) from current assets + net PP&E.
  const salesT = pos(t.sales), salesP = pos(p.sales);
  const taT = pos(t.ta), taP = pos(p.ta);
  if (!salesT || !salesP || !taT || !taP) return null;
  if (t.rec == null || p.rec == null || t.gp == null || p.gp == null || t.ca == null || p.ca == null ||
      t.ppe == null || p.ppe == null || t.dep == null || p.dep == null || t.sga == null || p.sga == null ||
      t.ltd == null || p.ltd == null || t.cl == null || p.cl == null || t.ni == null || t.cfo == null) return null;

  const dsriT = t.rec / salesT, dsriP = p.rec / salesP;
  const gmT = t.gp / salesT, gmP = p.gp / salesP;
  const aqT = 1 - (t.ca + t.ppe) / taT, aqP = 1 - (p.ca + p.ppe) / taP;
  const depRateT = t.dep + t.ppe, depRateP = p.dep + p.ppe;
  const sgaiT = t.sga / salesT, sgaiP = p.sga / salesP;
  const lvgiT = (t.cl + t.ltd) / taT, lvgiP = (p.cl + p.ltd) / taP;

  // Every ratio needs a positive denominator (a zero base = undefined change ⇒ null, not a wrong M).
  // t.dep/p.dep guarded strictly positive too: a zero-D&A TTM makes DEPI = ∞ → a bogus "high" flag
  // (∞ survives toFixed as a flag but serializes to null — a contradictory row + a corrupted sort).
  if (!pos(dsriP) || !pos(gmT) || !pos(gmP) || !pos(aqP) || !pos(depRateT) || !pos(depRateP) || !pos(sgaiP) || !pos(lvgiP) || !pos(t.dep) || !pos(p.dep)) return null;

  const DSRI = dsriT / dsriP;
  const GMI = gmP / gmT;                       // >1 when margin deteriorated
  const AQI = aqT / (aqP as number);
  const SGI = salesT / salesP;
  const DEPI = (p.dep / depRateP) / (t.dep / depRateT); // depreciation-rate: prior/current
  const SGAI = sgaiT / sgaiP;
  const LVGI = lvgiT / lvgiP;
  const TATA = (t.ni - t.cfo) / taT;

  return -4.84 + 0.920 * DSRI + 0.528 * GMI + 0.404 * AQI + 0.892 * SGI + 0.115 * DEPI - 0.172 * SGAI + 4.679 * TATA - 0.327 * LVGI;
}

// ── The public row ─────────────────────────────────────────────────────────────────────────────────
export type MFlag = "low" | "elevated" | "high";
export type ZZone = "safe" | "grey" | "distress";

export interface ForensicRow {
  symbol: string; name: string; sector: string; marketCap: number;
  asOf: string; // latest fiscal-year (TTM) period end
  mScore: number | null; mFlag: MFlag | null;
  zScore: number | null; zZone: ZZone | null;
  fScore: number | null; // 0..9
  accruals: number | null; // Sloan, fraction (NI−CFO)/avgTA
  flags: string[]; // human-readable red flags, most-severe first
}

export interface ForensicsData {
  generatedAt: string;
  universe: string;
  scanned: number;
  rows: ForensicRow[];
}

const FINANCIAL = /financ|bank|insurance/i;
const mFlagOf = (m: number | null): MFlag | null => (m == null ? null : m > -1.78 ? "high" : m > -2.22 ? "elevated" : "low");
const zZoneOf = (z: number | null): ZZone | null => (z == null ? null : z > 2.99 ? "safe" : z >= 1.81 ? "grey" : "distress");

/** Compute a name's forensics from its (widened) panel quarters + snapshot meta. Null if no usable
 *  TTM annual can be assembled. Pure. */
export function computeForensics(
  meta: { symbol: string; name: string; sector: string; marketCap: number; etf?: string },
  quarters: PQ[],
): ForensicRow | null {
  const q = dedupeQuarters(quarters);
  if (q.length < 4) return null;
  const t = assembleAnnual(q, q.length - 1);
  if (!t) return null;
  const p = assembleAnnual(q, q.length - 5); // one year earlier BY POSITION…
  // …but positional −4 quarters is "one year earlier" only when it's temporally ~1yr back. A data hole
  // / fiscal-year change / re-listing can make [len-8..len-5] span multiple years, and comparing t to it
  // fabricates a huge Beneish/Piotroski move that sorts straight to #1 with a manipulation flag. Require
  // the two annuals to be ~1yr apart; else the YoY scores go null (an honest gap, never a wrong line).
  const prior = p && spanDays(p.end, t.end) >= 270 && spanDays(p.end, t.end) <= 460 ? p : null;

  const isFinancial = (meta.etf || "").toUpperCase() === "XLF" || FINANCIAL.test(meta.sector || "");
  const mScore = prior ? beneishM(t, prior) : null;
  const zScore = altmanZ(t, meta.marketCap || null, isFinancial);
  const fScore = prior ? piotroskiF(t, prior) : null;
  const accruals = sloanAccruals(t);
  if (mScore == null && zScore == null && fScore == null && accruals == null) return null; // nothing computable

  const mFlag = mFlagOf(mScore), zZone = zZoneOf(zScore);
  const flags: string[] = [];
  if (mFlag === "high") flags.push("possible earnings manipulation");
  else if (mFlag === "elevated") flags.push("elevated manipulation score");
  if (zZone === "distress") flags.push("bankruptcy-distress zone");
  if (fScore != null && fScore <= 2) flags.push("weak fundamentals (low F-score)");
  if (accruals != null && accruals > 0.10) flags.push("high accruals (low earnings quality)");

  return {
    symbol: meta.symbol, name: meta.name, sector: meta.sector, marketCap: meta.marketCap,
    asOf: t.end,
    mScore: mScore == null ? null : +mScore.toFixed(2), mFlag,
    zScore: zScore == null ? null : +zScore.toFixed(2), zZone,
    fScore, accruals: accruals == null ? null : +accruals.toFixed(4),
    flags,
  };
}
