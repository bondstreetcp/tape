import { NextResponse } from "next/server";
import { getSegmentSource } from "@/lib/segments";
import { chatJSON, NO_ADVICE, PRO_MODEL, llmConfigured } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// FactSet-grade segment economics: extract revenue + operating income + margin per reportable
// segment from the filing's segment-note tables (the revenue-only parser misses OI), plus an AI
// segment read. Button-triggered; cached a day.
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  if (!(await llmConfigured())) return NextResponse.json({ configured: false });
  try {
    const src = await getSegmentSource(sym);
    if (!src) return NextResponse.json({ configured: true, available: false });

    const SYSTEM =
      "You read a company's reportable-segment footnote tables and return the segment P&L. For each REPORTABLE SEGMENT extract, for the MOST RECENT period shown: 'revenue' and 'operatingIncome' (segment operating income / profit), both in the filing's units as plain numbers (millions — e.g. 9357 for $9,357M; negative for a loss). Also give 'priorRevenue' (same segment, the prior comparable period) when the table shows it, else null. Skip 'Corporate/eliminations/unallocated/total' lines. " +
      "Then write a 'read' — 2-3 sentences: which segment drives revenue and profit, the highest- and lowest-margin segments, and what's growing vs shrinking. " +
      "'period' = the most-recent period label (e.g. 'FY2025' or 'Q2 2026'). Extract ONLY numbers present in the tables; if operating income isn't disclosed per segment, return [] for segments and say so in 'read'. " +
      NO_ADVICE;
    const SCHEMA = 'Return ONLY JSON: {"period": string, "segments": [{"name": string, "revenue": number, "operatingIncome": number|null, "priorRevenue": number|null}], "read": string}';
    const out = await chatJSON<any>(SYSTEM, `${SCHEMA}\n\nSegment-note tables for ${sym} (${src.form} filed ${src.date}):\n${src.text}`, { maxTokens: 3500, model: PRO_MODEL, reasoningEffort: "low" });

    const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    const segments = (Array.isArray(out?.segments) ? out.segments : [])
      .filter((s: any) => s && typeof s.name === "string" && s.name.trim() && num(s.revenue) != null)
      .map((s: any) => {
        const revenue = num(s.revenue) as number;
        const operatingIncome = num(s.operatingIncome);
        const priorRevenue = num(s.priorRevenue);
        return {
          name: String(s.name).trim().slice(0, 48),
          revenue,
          operatingIncome,
          marginPct: operatingIncome != null && revenue ? (operatingIncome / revenue) * 100 : null,
          revGrowthPct: priorRevenue && priorRevenue > 0 ? (revenue / priorRevenue - 1) * 100 : null,
        };
      })
      .slice(0, 12);

    // The segment source EXISTS here. A legit "OI isn't disclosed per segment" reply carries the
    // explanation in `read`; a reply with NEITHER segments NOR read (or a null from chatJSON) is a
    // failed AI read — flag it distinctly (never cached) so the UI offers a retry instead of
    // asserting the filing doesn't break out segments.
    if (!segments.length && !(typeof out?.read === "string" && out.read.trim()))
      return NextResponse.json({ configured: true, aiFailed: true }, { headers: { "Cache-Control": "no-store" } });

    return NextResponse.json(
      { configured: true, available: true, period: typeof out?.period === "string" ? out.period.trim() : src.date, url: src.url, form: src.form, segments, read: typeof out?.read === "string" ? out.read.trim() : "" },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=172800" } },
    );
  } catch (e: any) {
    // A thrown error (fetch/transport) is transient — "try again", not "not broken out".
    return NextResponse.json({ configured: true, aiFailed: true, error: String(e?.message || e).slice(0, 200) }, { headers: { "Cache-Control": "no-store" } });
  }
}
