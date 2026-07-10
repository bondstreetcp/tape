/**
 * Executive & director compensation — extracted on demand from the company's own filings (DEF 14A
 * proxy; S-1 for a recent IPO; Form 10 for a spin) via /api/compensation/[symbol]. Three reads:
 *   1. WHO gets paid WHAT — the Summary Compensation Table, up to 3 fiscal years per proxy (the
 *      "historically" view) broken into salary / bonus / stock / options / non-equity incentive / other.
 *   2. HOW pay is earned (the part that matters) — the annual-bonus metrics + weightings and the
 *      long-term-incentive design (PSU metrics, vesting, mix) from the CD&A.
 *   3. The extras — perquisites (aircraft, security, …) and director pay.
 * GROUNDED: every dollar figure must literally appear in the filing text; per-person rows must sit
 * near that person's name. Missing = null, never invented. CLIENT-SAFE (types only).
 */

export interface CompYear {
  year: number;
  salary: number | null;
  bonus: number | null; // discretionary cash bonus column
  stock: number | null; // stock awards (grant-date fair value)
  options: number | null; // option awards
  nonEquity: number | null; // non-equity incentive plan (the "earned" annual bonus)
  other: number | null; // all other compensation (perks, 401k, security…)
  total: number | null;
}

export interface ExecComp {
  name: string;
  title: string | null;
  years: CompYear[]; // newest first
}

export interface CompMetric {
  metric: string; // e.g. "Adjusted EBITDA", "Relative TSR vs S&P 500"
  weightPct: number | null; // share of that plan, where disclosed
  detail: string | null; // target / threshold-max / vesting color, verbatim-ish
}

export interface DirectorComp {
  cashRetainer: number | null; // annual board cash retainer
  equityAnnual: number | null; // annual equity grant value
  note: string | null; // extra structure (committee fees, chair premiums)
}

export interface CompensationResponse {
  symbol: string;
  source: { url: string; date: string; form: string } | null;
  execs: ExecComp[];
  bonusMetrics: CompMetric[]; // annual cash incentive design
  ltiMetrics: CompMetric[]; // long-term equity incentive design
  payMix: string | null; // e.g. "~90% of CEO target pay at-risk; LTI 60% PSUs / 40% RSUs"
  perks: { who: string | null; item: string }[];
  directors: DirectorComp | null;
  sayOnPay: string | null; // last say-on-pay support, where disclosed
  note?: string; // honest empty-state / failure reason
}

/** True when a response carries anything worth rendering. */
export function compHasDetail(r: CompensationResponse | null): boolean {
  return !!r && (r.execs.length > 0 || r.bonusMetrics.length > 0 || r.ltiMetrics.length > 0);
}
