import { NextResponse } from "next/server";
import { getSegmentSource } from "@/lib/segments";
import { cachedStats } from "@/lib/companyCache";
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
    // stats supplies the reference revenue for the reconciliation gate below (best-effort — a
    // Yahoo blip must not take the feature down, so its failure just skips the gate).
    const [src, stats] = await Promise.all([getSegmentSource(sym), cachedStats(sym).catch(() => null)]);
    if (!src) return NextResponse.json({ configured: true, available: false });

    const SYSTEM =
      "You read a company's reportable-segment footnote tables and return the segment P&L. For each REPORTABLE SEGMENT extract, for the MOST RECENT period shown: 'revenue' and 'operatingIncome' (segment operating income / profit), ALWAYS expressed in MILLIONS as plain numbers (e.g. 9357 for $9,357M; if the tables are stated in thousands, divide by 1,000; negative for a loss). Also give 'priorRevenue' (same segment, the prior comparable period) when the table shows it, else null. Skip 'Corporate/eliminations/unallocated/total' lines. " +
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

    // Reconciliation gate (audit C2): Σ(segment revenues) must land within 0.5–2× of a revenue this
    // terminal already knows, or the extraction is a units misread (thousands-vs-millions) or the
    // wrong column (YTD vs quarter) — confidently wrong numbers that would cache for a day. Segment
    // notes are annual in a 10-K and quarterly/YTD in a 10-Q, so test BOTH bases and pass on either
    // (a YTD column sits inside the union of the two bands). No reference available → gate skipped.
    let reconciledVs: string | null = null;
    const sumM = segments.reduce((a: number, s: { revenue: number }) => a + (s.revenue > 0 ? s.revenue : 0), 0);
    if (segments.length && sumM > 0) {
      const sumUsd = sumM * 1e6; // segments are extracted in millions
      const qRev = stats?.estimates?.find((e) => e.period === "0q")?.revAvg ?? null; // consensus quarter, raw $
      const yRev = stats?.totalRevenue ?? stats?.estimates?.find((e) => e.period === "0y")?.revAvg ?? null; // TTM actual (else FY consensus), raw $
      const refs: { label: string; v: number }[] = [];
      if (yRev && yRev > 0) refs.push({ label: stats?.totalRevenue ? "TTM revenue" : "FY consensus revenue", v: yRev });
      if (qRev && qRev > 0) refs.push({ label: "quarterly consensus revenue", v: qRev });
      if (refs.length) {
        const hit = refs.find((r) => sumUsd >= r.v * 0.5 && sumUsd <= r.v * 2);
        if (!hit) {
          console.warn(`segment-economics ${sym}: Σsegments $${Math.round(sumM)}M outside 0.5–2× of ${refs.map((r) => `${r.label} $${Math.round(r.v / 1e6)}M`).join(" / ")} — refusing to serve`);
          return NextResponse.json({ configured: true, aiFailed: true }, { headers: { "Cache-Control": "no-store" } });
        }
        reconciledVs = hit.label;
        console.log(`segment-economics ${sym}: Σsegments $${Math.round(sumM)}M reconciled vs ${hit.label} $${Math.round(hit.v / 1e6)}M`);
      } else {
        console.warn(`segment-economics ${sym}: no reference revenue available — reconciliation skipped`);
      }
    }

    return NextResponse.json(
      { configured: true, available: true, period: typeof out?.period === "string" ? out.period.trim() : src.date, url: src.url, form: src.form, segments, read: typeof out?.read === "string" ? out.read.trim() : "", reconciledVs },
      { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=172800" } },
    );
  } catch (e: any) {
    // A thrown error (fetch/transport) is transient — "try again", not "not broken out".
    return NextResponse.json({ configured: true, aiFailed: true, error: String(e?.message || e).slice(0, 200) }, { headers: { "Cache-Control": "no-store" } });
  }
}
