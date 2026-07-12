/**
 * Company Briefing — a generalist's primer on ANY public company, drilled from its latest 10-K via
 * /api/company-briefing/[symbol]. The 10-K's Item 1 (Business — with the industry, competition,
 * customers and suppliers a company is required to describe), Item 1A (Risk Factors) and Item 7
 * (MD&A) hold everything an analyst new to the name needs. We synthesize a structured primer,
 * GROUNDED (named competitors must appear in the filing; nothing invented) and honest that it's the
 * company's OWN account. Complements the narrower per-stock lenses (risk-factor changes, segment P&L,
 * supply-chain map, transcript analysis) — this is the holistic "understand the business fast" read.
 * CLIENT-SAFE (types only).
 */

export interface CompanyBriefing {
  symbol: string;
  source: { url: string; date: string; form: string } | null;
  whatItIs: string | null; // the business in plain terms
  howItMakesMoney: string | null; // revenue model / main segments
  industry: string | null; // how the industry works — structure, drivers, cyclicality, dynamics
  competitivePosition: string | null; // where it sits + what differentiates it
  competitors: string[]; // named rivals (grounded — each appears in the filing)
  customers: string | null; // who buys + any concentration
  suppliers: string | null; // key inputs / suppliers + commodity or single-source exposure
  moats: string[]; // durable advantages the filing claims
  risks: string[]; // the industry / competitive / value-chain risks that matter most
  watchItems: string[]; // 2–4 things a generalist should track
  note?: string; // honest empty-state / failure reason
}

/** True when a briefing carries enough to render. */
export function briefingHasDetail(r: CompanyBriefing | null): boolean {
  return !!r && !!(r.whatItIs || r.industry || r.competitors.length || r.competitivePosition);
}
