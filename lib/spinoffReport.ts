/**
 * Spin-off Briefing — a generalist's primer on an upcoming spin, drilled from the SpinCo's Form 10
 * (10-12B) registration statement via /api/spinoff-report/[cik]. A Form 10 is WRITTEN to bring an
 * investor who's never heard of the SpinCo up to speed, so it carries the whole picture: what the
 * business is and why it's being separated, how the industry works, the named competitors, the
 * customer and supplier base, and the risks that matter. We synthesize that into a structured brief,
 * GROUNDED (named competitors/customers/suppliers must appear in the filing; nothing invented) and
 * honest that it's the ISSUER'S OWN account — a generalist should cross-check the other side.
 * CLIENT-SAFE (types only).
 */

export interface SpinoffFinancials {
  revenue: string | null; // most-recent revenue, verbatim-ish ("$1.24B FY2025")
  growth: string | null; // revenue growth trend ("+8% YoY")
  profitability: string | null; // margin / profit note ("~18% EBITDA margin")
  note: string | null; // any caveat (carve-out financials, pro-forma, etc.)
}

export interface SpinoffReport {
  cik: string;
  spinco: string;
  parent: string | null;
  source: { url: string; date: string; form: string } | null;
  whatItIs: string | null; // the business in plain terms
  whySpun: string | null; // the stated separation rationale
  howItMakesMoney: string | null; // revenue model / segments
  industry: string | null; // how the industry works — structure, size/growth, cyclicality, dynamics
  competitivePosition: string | null; // where it sits + differentiation
  competitors: string[]; // named rivals (grounded — each appears in the filing)
  customers: string | null; // customer base + concentration
  suppliers: string | null; // key inputs / suppliers + commodity or concentration exposure
  moats: string[]; // durable advantages the filing claims (grounded phrases)
  risks: string[]; // the industry / competitive / value-chain risks that matter most
  watchItems: string[]; // 2–4 things a generalist should track from here
  financials: SpinoffFinancials | null;
  note?: string; // honest empty-state / failure reason
}

/** True when a briefing carries enough to render. */
export function reportHasDetail(r: SpinoffReport | null): boolean {
  return !!r && !!(r.whatItIs || r.industry || r.competitors.length || r.whySpun);
}
