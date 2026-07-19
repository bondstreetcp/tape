import { NextRequest, NextResponse } from "next/server";
import { tickerToCik } from "@/lib/edgar";
import { gather10K } from "@/lib/spinoffFilings";
import { chatJSON, PRO_MODEL, NO_ADVICE, llmConfigured } from "@/lib/llm";
import { section, namedCompetitors, phraseGrounded, norm, clean, strList } from "@/lib/filingSections";
import type { CompanyBriefing } from "@/lib/companyBriefing";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// A generalist's briefing drilled from a company's latest 10-K — the annual report's Item 1 Business
// (industry, competition, customers, suppliers), Item 1A Risk Factors and Item 7 MD&A carry the whole
// picture. We section-window those and let the PRO model synthesize a structured primer, GROUNDED
// (named competitors regex-pulled from the filing) and framed as the company's OWN account.

const SYSTEM =
  "You brief an INDUSTRY-GENERALIST analyst on a public company using ONLY the text of its SEC Form 10-K (annual report). The goal: get someone who doesn't know this business or industry up to speed fast. Return JSON. " +
  "whatItIs: 2-3 plain sentences on what the business actually does. howItMakesMoney: the revenue model / main reportable segments and roughly where the money comes from. " +
  "industry: 3-5 sentences on HOW THE INDUSTRY WORKS for a newcomer — its structure, what drives demand, size/growth if stated, cyclicality, and the key dynamics. competitivePosition: where this company sits (leader/challenger/niche) and what, if anything, differentiates it. " +
  "competitors: an array of the SPECIFIC competitors NAMED in the filing (company names only; [] if none named — never guess). customers: who buys (end-markets) and any customer-concentration disclosed. suppliers: the key inputs / suppliers and any commodity or single-source exposure. " +
  "moats: array of durable advantages the filing claims (scale, IP, switching costs, brand, regulatory — short phrases). risks: array of the 3-6 industry/competitive/value-chain risks that most matter (short phrases, not boilerplate). watchItems: 2-4 concrete things a generalist should track from here. " +
  "CRITICAL: use ONLY what the filing states — never add outside knowledge, never invent a competitor, number, or market-share figure. This is the company's own account; write it faithfully and neutrally, not promotionally. " +
  NO_ADVICE;

const SCHEMA =
  'Return ONLY JSON: {"whatItIs":string|null,"howItMakesMoney":string|null,"industry":string|null,"competitivePosition":string|null,' +
  '"competitors":string[],"customers":string|null,"suppliers":string|null,"moats":string[],"risks":string[],"watchItems":string[]}';

// gather10K moved to lib/spinoffFilings.ts — shared with the two-entity spin preview route.

export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const base = (extra: Partial<CompanyBriefing>): CompanyBriefing =>
    ({ symbol: sym, source: null, whatItIs: null, howItMakesMoney: null, industry: null, competitivePosition: null, competitors: [], customers: null, suppliers: null, moats: [], risks: [], watchItems: [], ...extra });
  const noStore = { headers: { "Cache-Control": "no-store" } };

  if (!(await llmConfigured())) return NextResponse.json(base({ note: "The briefing needs the LLM configured." }), noStore);
  const cik = await tickerToCik(sym).catch(() => null);
  if (!cik) return NextResponse.json(base({ note: "No SEC filer found for this ticker (US filers only)." }), noStore);
  const src = await gather10K(cik);
  if (!src) return NextResponse.json(base({ note: "No 10-K with readable text found on EDGAR for this filer." }), noStore);

  const s = (re: RegExp, len: number, o: Parameters<typeof section>[3] = {}) => section(src.text, re, len, o);
  const packed = [
    s(/\b(item\s*1\.?\s*business|business overview|our business|overview of (the|our) (company|business))/i, 20000, { first: true }),
    s(/\b(our industry|industry overview|market overview|industry background)/i, 12000, { first: true }),
    s(/\bcompetiti(on|ve)\b/i, 10000, { scoreRe: /\bcompet|\brival|\bpeer|market (share|leader)|companies (such as|including|like|that)/gi }),
    s(/(we (primarily )?compete (with|against)|our (primary |principal |main )?competitors (include|are|such as)|principal competitors|competitors include)/i, 3500, { first: true, minScore: 1, back: 200 }),
    s(/\b(our customers|customers\b|customer concentration|end[- ]markets)/i, 5000),
    s(/\b(suppliers|raw materials|supply chain|sources? of supply)/i, 5000),
    s(/\brisk factors\b/i, 14000, { scoreRe: /\bcompetit|industry|customer|supplier|demand|cyclic|regulat|concentrat/gi }),
    s(/(management['’]s discussion|results of operations|overview\b)/i, 9000, { scoreRe: /revenue|margin|growth|segment|driven|increase|decrease/gi }),
  ].filter((x) => x.replace(/\s/g, "").length > 300).join("\n\n=====\n\n").slice(0, 95000);
  if (packed.replace(/\s/g, "").length < 3000) return NextResponse.json(base({ source: { url: src.url, date: src.date, form: src.form }, note: "The 10-K didn't yield the sections needed for a briefing." }), noStore);

  // reasoningEffort low keeps this LIVE call inside the 60s function budget; PRO model — analytical synthesis.
  const out = await chatJSON<any>(SYSTEM, `${sym} 10-K (filed ${src.date}):\n\n${packed}\n\n${SCHEMA}`, { model: PRO_MODEL, maxTokens: 5000, reasoningEffort: "low" }).catch(() => null);
  if (!out) return NextResponse.json(base({ source: { url: src.url, date: src.date, form: src.form }, note: "Briefing generation failed — try again." }), noStore);

  // Named rivals: the code-extracted list (grounded by construction) first, then any LLM extras whose
  // FULL name appears as a contiguous phrase in the filing (phraseGrounded — a scattered-word check
  // would let a fabricated common-word "competitor" slip past the "pulled verbatim" claim the UI makes).
  const textNorm = norm(src.text);
  const competitors = (() => {
    const seen = new Set<string>();
    const merged: string[] = [];
    const llmExtras = strList(out.competitors, null, 12).filter((c) => phraseGrounded(c, textNorm));
    for (const c of [...namedCompetitors(src.text), ...llmExtras]) {
      const k = c.toLowerCase();
      if (!seen.has(k)) { seen.add(k); merged.push(c); }
    }
    return merged.slice(0, 12);
  })();

  const resp = base({
    source: { url: src.url, date: src.date, form: src.form },
    whatItIs: clean(out.whatItIs),
    howItMakesMoney: clean(out.howItMakesMoney),
    industry: clean(out.industry, 1400),
    competitivePosition: clean(out.competitivePosition),
    competitors,
    customers: clean(out.customers),
    suppliers: clean(out.suppliers),
    moats: strList(out.moats, null, 6),
    risks: strList(out.risks, null, 8),
    watchItems: strList(out.watchItems, null, 5),
  });
  const any = resp.whatItIs || resp.industry || resp.competitors.length;
  if (!any) resp.note = "The 10-K didn't yield an extractable briefing.";
  // 10-Ks are annual → cache hard on success; never cache a failure.
  return NextResponse.json(resp, { headers: { "Cache-Control": any ? "public, s-maxage=86400, stale-while-revalidate=1209600" : "no-store" } });
}
