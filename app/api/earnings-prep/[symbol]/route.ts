import { NextResponse } from "next/server";
import { getCompanyStats } from "@/lib/companyStats";
import { getEarningsReactions } from "@/lib/earningsReaction";
import { loadEarningsMove } from "@/lib/earningsMove";
import { getNews } from "@/lib/news";
import { chatJSON, NO_ADVICE, PRO_MODEL, llmConfigured } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 45;

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

    // GLM "what matters this quarter" — grounded in consensus, revision direction, analyst moves, news.
    let whatMatters: { debates: string[]; bull: string; bear: string } | null = null;
    if (await llmConfigured()) {
      const q0 = stats?.estimates?.find((e) => e.period === "0q") || stats?.estimates?.[0];
      const revDir = q0 && q0.epsCurrent != null && q0.eps90dAgo != null ? (q0.epsCurrent > q0.eps90dAgo ? "rising" : q0.epsCurrent < q0.eps90dAgo ? "falling" : "flat") : "n/a";
      const upDn = q0 ? `${q0.epsUp30d ?? 0} up / ${q0.epsDown30d ?? 0} down (30d)` : "n/a";
      const ctx =
        `Ticker ${sym}. Upcoming quarter consensus: EPS ${q0?.epsAvg ?? "?"} (range ${q0?.epsLow ?? "?"}–${q0?.epsHigh ?? "?"}, ${q0?.epsAnalysts ?? "?"} analysts), revenue ${q0?.revAvg ? "$" + (q0.revAvg / 1e9).toFixed(2) + "B" : "?"}, YoY growth ${q0?.growth != null ? (q0.growth * 100).toFixed(0) + "%" : "?"}. ` +
        `Estimate trend: EPS estimates ${revDir} (now ${q0?.epsCurrent ?? "?"} vs ${q0?.eps90dAgo ?? "?"} 90d ago), revisions ${upDn}. ` +
        `Valuation fwd P/E ${stats?.forwardPE?.toFixed(0) ?? "?"}, rev growth ${stats?.revenueGrowth != null ? (stats.revenueGrowth * 100).toFixed(0) + "%" : "?"}, op margin ${stats?.operatingMargins != null ? (stats.operatingMargins * 100).toFixed(0) + "%" : "?"}, short ${stats?.shortPercentOfFloat != null ? (stats.shortPercentOfFloat * 100).toFixed(1) + "% of float" : "?"}. ` +
        `Recent analyst moves: ${(stats?.ratingChanges || []).slice(0, 5).map((c) => `${c.firm} ${c.action} ${c.toGrade || ""}${c.targetTo ? " PT " + c.targetTo : ""}`).join("; ") || "none on file"}. ` +
        `Recent headlines: ${(news || []).slice(0, 6).map((n) => n.title.trim()).filter(Boolean).join(" | ") || "none"}.`;
      const SYSTEM =
        "You are a buy-side analyst doing earnings prep on a stock about to report. Use BOTH the supplied data (consensus, estimate-revision direction, analyst moves, positioning, recent news) AND your own knowledge of this company's business and key value drivers. " +
        "'debates' (ALWAYS return 2-3) = the specific things investors will fixate on for THIS company's quarter — concrete KPIs, segments, or guidance items (e.g. for a chipmaker: data-center revenue + next-Q guide; for software: net revenue retention; for a retailer: comps + gross margin; for biotech: a pipeline/FDA read). Name the actual metrics for THIS company, not a generic 'will they beat EPS'. " +
        "'bull' = the bull case into the print (why it works, incl. whether estimates look beatable / the bar is low). 'bear' = the bear case (what disappoints / what's already priced in). Ground numbers in the supplied data; never invent figures. Two sentences max per field. " +
        NO_ADVICE;
      const SCHEMA = 'Return ONLY JSON: {"debates": string[], "bull": string, "bear": string}';
      const out = await chatJSON<{ debates: string[]; bull: string; bear: string }>(SYSTEM, ctx, { maxTokens: 3000, model: PRO_MODEL });
      if (out && (out.bull || out.bear || (out.debates && out.debates.length))) {
        whatMatters = {
          debates: (Array.isArray(out.debates) ? out.debates : []).filter((x) => typeof x === "string").slice(0, 4),
          bull: typeof out.bull === "string" ? out.bull.trim() : "",
          bear: typeof out.bear === "string" ? out.bear.trim() : "",
        };
      }
    }

    return NextResponse.json(
      { prep: { reaction, impliedMove, whatMatters } },
      { headers: { "Cache-Control": "public, s-maxage=10800, stale-while-revalidate=21600" } },
    );
  } catch {
    return NextResponse.json({ prep: null });
  }
}
