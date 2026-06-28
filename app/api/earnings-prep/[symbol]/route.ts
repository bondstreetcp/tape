import { NextResponse } from "next/server";
import { getCompanyStats } from "@/lib/companyStats";
import { getEarningsReactions } from "@/lib/earningsReaction";
import { loadEarningsMove } from "@/lib/earningsMove";
import { getNews } from "@/lib/news";
import { chatJSON, NO_ADVICE, PRO_MODEL, llmConfigured } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const pct = (v: number | null | undefined, d = 1) => (v == null ? "?" : `${v >= 0 ? "+" : ""}${(v * (Math.abs(v) < 5 ? 100 : 1)).toFixed(d)}%`);

// The lazy half of the earnings prep: the post-earnings reaction track record, the options-implied
// move, and a GLM "what matters this quarter" (the key debates + bull/bear into the print). The
// deterministic consensus/revisions/surprises come straight from the stats the page already has.
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  try {
    const [stats, reactions, emove, news] = await Promise.all([
      getCompanyStats(sym).catch(() => null),
      getEarningsReactions(sym, 8).catch(() => []),
      loadEarningsMove().catch(() => null),
      getNews(sym, 8).catch(() => []),
    ]);

    // Reaction track record (close-to-close magnitude + how often it popped).
    const moves = (reactions || []).map((r) => r.move).filter((m): m is number => m != null);
    const reaction = moves.length
      ? {
          avgAbsMove: moves.reduce((a, m) => a + Math.abs(m), 0) / moves.length,
          maxAbsMove: Math.max(...moves.map(Math.abs)),
          upRate: moves.filter((m) => m > 0).length / moves.length,
          n: moves.length,
        }
      : null;
    const impliedMove = (emove?.rows || []).find((r) => r.symbol === sym)?.impliedMovePct ?? null;

    // StreetAccount-style earnings preview — grounded in consensus, revisions, positioning, analyst moves, news.
    let preview: { overview: string; watch: string[]; guidance: string; datapoints: string[]; bull: string; bear: string } | null = null;
    if (await llmConfigured()) {
      const q0 = stats?.estimates?.find((e) => e.period === "0q") || stats?.estimates?.[0];
      const revDir = q0 && q0.epsCurrent != null && q0.eps90dAgo != null ? (q0.epsCurrent > q0.eps90dAgo ? "rising" : q0.epsCurrent < q0.eps90dAgo ? "falling" : "flat") : "n/a";
      const upDn = q0 ? `${q0.epsUp30d ?? 0} up / ${q0.epsDown30d ?? 0} down (30d)` : "n/a";
      const ctx =
        `Ticker ${sym}. Upcoming-quarter consensus: EPS ${q0?.epsAvg ?? "?"} (range ${q0?.epsLow ?? "?"}–${q0?.epsHigh ?? "?"}, ${q0?.epsAnalysts ?? "?"} analysts), revenue ${q0?.revAvg ? "$" + (q0.revAvg / 1e9).toFixed(2) + "B" : "?"}, YoY growth ${q0?.growth != null ? (q0.growth * 100).toFixed(0) + "%" : "?"}. ` +
        `Estimate trend: EPS ${revDir} (now ${q0?.epsCurrent ?? "?"} vs ${q0?.eps90dAgo ?? "?"} 90d ago), revisions ${upDn}. ` +
        `Setup: ${impliedMove != null ? `options imply a ±${impliedMove.toFixed(1)}% move` : "implied move n/a"}; ${reaction ? `past prints moved ±${(reaction.avgAbsMove * 100).toFixed(1)}% on avg (max ${(reaction.maxAbsMove * 100).toFixed(0)}%), higher ${(reaction.upRate * 100).toFixed(0)}% of the time` : "limited reaction history"}; fwd P/E ${stats?.forwardPE?.toFixed(0) ?? "?"}, op margin ${stats?.operatingMargins != null ? (stats.operatingMargins * 100).toFixed(0) + "%" : "?"}, short ${stats?.shortPercentOfFloat != null ? (stats.shortPercentOfFloat * 100).toFixed(1) + "% of float" : "?"}. ` +
        `Recent analyst moves: ${(stats?.ratingChanges || []).slice(0, 6).map((c) => `${c.firm} ${c.action} ${c.toGrade || ""}${c.targetTo ? " PT " + c.targetTo : ""}`).join("; ") || "none on file"}. ` +
        `Recent headlines: ${(news || []).slice(0, 8).map((n) => n.title.trim()).filter(Boolean).join(" | ") || "none"}.`;
      const SYSTEM =
        "Write a FactSet StreetAccount-style EARNINGS PREVIEW for the stock about to report — factual, concise, sell-side-desk voice, no hedging filler, no advice. Use BOTH the supplied data and your own knowledge of the company's business and key value drivers. Fields: " +
        "'overview' = a 1-2 sentence lead: the consensus the Street is looking for and how the stock is set up going in (recent performance / positioning / whether the bar looks high or low). " +
        "'watch' = 3-5 SPECIFIC items the Street is focused on THIS quarter — name the actual KPIs / segments / guidance lines for THIS company (e.g. Data Center revenue + next-Q guide; net revenue retention; same-store sales + gross margin; a pipeline/FDA readout), each a short phrase, never a generic 'will they beat EPS'. " +
        "'guidance' = the company's standing guidance for the quarter/year and the expectation (raise / reaffirm / cut / first guide), or note if it doesn't give formal guidance. " +
        "'datapoints' = 2-4 recent relevant reads since last quarter — peer results, industry/channel data, pre-announcements, notable analyst actions (use the supplied headlines + your knowledge). " +
        "'bull' = the bull case into the print; 'bear' = the bear case / what's already priced in. " +
        "Use specific NUMBERS only from the supplied data; for segment/guidance specifics, name the item and direction but do NOT fabricate precise figures. " +
        NO_ADVICE;
      const SCHEMA = 'Return ONLY JSON: {"overview": string, "watch": string[], "guidance": string, "datapoints": string[], "bull": string, "bear": string}';
      const out = await chatJSON<{ overview: string; watch: string[]; guidance: string; datapoints: string[]; bull: string; bear: string }>(SYSTEM, ctx, { maxTokens: 4000, model: PRO_MODEL });
      const arr = (a: unknown) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && (x as string).trim()).map((x) => (x as string).trim()).slice(0, 6) : []);
      const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      if (out && (s(out.overview) || s(out.bull) || arr(out.watch).length)) {
        preview = { overview: s(out.overview), watch: arr(out.watch), guidance: s(out.guidance), datapoints: arr(out.datapoints), bull: s(out.bull), bear: s(out.bear) };
      }
    }

    return NextResponse.json(
      { prep: { reaction, impliedMove, preview } },
      { headers: { "Cache-Control": "public, s-maxage=10800, stale-while-revalidate=21600" } },
    );
  } catch {
    return NextResponse.json({ prep: null });
  }
}
