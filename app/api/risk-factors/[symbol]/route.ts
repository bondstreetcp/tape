import { NextResponse } from "next/server";
import { fetchRiskFactorSections, type RiskChange } from "@/lib/riskFactors";
import { chatJSON, NO_ADVICE, PRO_MODEL, llmConfigured } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Diffs a company's two most recent 10-K "Item 1A. Risk Factors" sections. Lazy per-stock; cached
// a day (risk factors only change annually). Returns { diff: null } when it can't extract/compare.
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    if (!(await llmConfigured())) return NextResponse.json({ diff: null });
    const secs = await fetchRiskFactorSections(symbol);
    if (!secs) return NextResponse.json({ diff: null });
    const sym = decodeURIComponent(symbol).toUpperCase();

    const SYSTEM =
      "You compare the 'Risk Factors' (Item 1A) section of a company's two most recent annual reports (10-K). Identify what MEANINGFULLY changed year-over-year: (added) genuinely NEW risk factors the company introduced; (removed) risks it dropped or materially de-emphasized; (intensified) existing risks it notably expanded or sharpened. Ignore cosmetic reordering, boilerplate, and wording tweaks — surface only substantive changes a careful reader would flag. For each change give a short title + a one-line note. Also a one-sentence 'summary' of the net shift in the risk profile. Ground everything strictly in the supplied text; if nothing material changed, return empty arrays and say so in the summary. " +
      NO_ADVICE;
    const SCHEMA = 'Return ONLY JSON: {"summary": string, "added": [{"title": string, "note": string}], "removed": [{"title": string, "note": string}], "intensified": [{"title": string, "note": string}]}';
    const user = `${SCHEMA}\n\nCompany $${sym}.\n\n=== PRIOR 10-K (filed ${secs.prior.date}) — Item 1A Risk Factors ===\n${secs.prior.text}\n\n=== CURRENT 10-K (filed ${secs.curr.date}) — Item 1A Risk Factors ===\n${secs.curr.text}`;

    const out = await chatJSON<{ summary: string; added: RiskChange[]; removed: RiskChange[]; intensified: RiskChange[] }>(SYSTEM, user, { maxTokens: 2500, model: PRO_MODEL });
    if (!out) return NextResponse.json({ diff: null });
    const clean = (a: unknown): RiskChange[] =>
      (Array.isArray(a) ? a : [])
        .filter((x): x is RiskChange => !!x && typeof (x as any).title === "string")
        .map((x) => ({ title: String(x.title).trim().slice(0, 120), note: String(x.note || "").trim().slice(0, 240) }))
        .slice(0, 8);

    return NextResponse.json(
      {
        diff: {
          symbol: sym,
          currentDate: secs.curr.date,
          priorDate: secs.prior.date,
          summary: String(out.summary || "").trim(),
          added: clean(out.added),
          removed: clean(out.removed),
          intensified: clean(out.intensified),
        },
      },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=172800" } },
    );
  } catch {
    return NextResponse.json({ diff: null });
  }
}
