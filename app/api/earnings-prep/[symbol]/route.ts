import { NextResponse } from "next/server";
import { getCompanyStats } from "@/lib/companyStats";
import { getEarningsReactions } from "@/lib/earningsReaction";
import { loadEarningsMove } from "@/lib/earningsMove";
import { getOptions, type OptionChain } from "@/lib/options";
import { getNews } from "@/lib/news";
import { chatJSON, NO_ADVICE, PRO_MODEL, llmConfigured } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Two parts: ?part=data (fast, no LLM — reaction history, options skew/max-pain; auto-loaded) and
// ?part=ai (the StreetAccount-style preview; button-triggered, slow Gemini reasoning call).

function optionsRead(chain: OptionChain | null) {
  if (!chain || !chain.underlying || (!chain.calls.length && !chain.puts.length)) return null;
  const u = chain.underlying;
  const strikes = [...new Set([...chain.calls, ...chain.puts].map((o) => o.strike))].sort((a, b) => a - b);
  if (strikes.length < 3) return null;
  const atm = strikes.reduce((a, b) => (Math.abs(b - u) < Math.abs(a - u) ? b : a));
  const cIV = chain.calls.find((o) => o.strike === atm)?.iv ?? null;
  const pIV = chain.puts.find((o) => o.strike === atm)?.iv ?? null;
  const atmVals = [cIV, pIV].filter((v): v is number => v != null && v > 0);
  // Max pain: the settle price (= a listed strike) that minimizes total option payout to holders.
  let maxPain: number | null = null, bestPay = Infinity;
  for (const S of strikes) {
    let pay = 0;
    for (const c of chain.calls) if (c.oi && c.strike < S) pay += c.oi * (S - c.strike);
    for (const p of chain.puts) if (p.oi && p.strike > S) pay += p.oi * (p.strike - S);
    if (pay < bestPay) { bestPay = pay; maxPain = S; }
  }
  return {
    expiry: chain.selected,
    atmIV: atmVals.length ? atmVals.reduce((a, b) => a + b, 0) / atmVals.length : null,
    skew: cIV != null && pIV != null ? pIV - cIV : null, // >0 = puts bid over calls (downside hedging)
    maxPain,
    maxPainVsSpot: maxPain ? maxPain / u - 1 : null,
  };
}

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const part = new URL(req.url).searchParams.get("part") || "data";

  try {
    // ── AI part: the StreetAccount-style preview (button-triggered) ──
    if (part === "ai") {
      if (!(await llmConfigured())) return NextResponse.json({ ai: null });
      const [stats, news] = await Promise.all([getCompanyStats(sym).catch(() => null), getNews(sym, 8).catch(() => [])]);
      const q0 = stats?.estimates?.find((e) => e.period === "0q") || stats?.estimates?.[0];
      const revDir = q0 && q0.epsCurrent != null && q0.eps90dAgo != null ? (q0.epsCurrent > q0.eps90dAgo ? "rising" : q0.epsCurrent < q0.eps90dAgo ? "falling" : "flat") : "n/a";
      const dist = stats?.ratings ? `${stats.ratings.strongBuy + stats.ratings.buy} buy / ${stats.ratings.hold} hold / ${stats.ratings.sell + stats.ratings.strongSell} sell` : "n/a";
      const ctx =
        `Ticker ${sym}. Upcoming-quarter consensus: EPS ${q0?.epsAvg ?? "?"} (range ${q0?.epsLow ?? "?"}–${q0?.epsHigh ?? "?"}, ${q0?.epsAnalysts ?? "?"} analysts), revenue ${q0?.revAvg ? "$" + (q0.revAvg / 1e9).toFixed(2) + "B" : "?"}, YoY growth ${q0?.growth != null ? (q0.growth * 100).toFixed(0) + "%" : "?"}. ` +
        `EPS estimates ${revDir} (revisions ${q0?.epsUp30d ?? 0} up / ${q0?.epsDown30d ?? 0} down, 30d). Sell-side: ${dist}, mean PT ${stats?.targetMean ?? "?"} vs price ${stats?.price ?? "?"}. ` +
        `Valuation fwd P/E ${stats?.forwardPE?.toFixed(0) ?? "?"}, op margin ${stats?.operatingMargins != null ? (stats.operatingMargins * 100).toFixed(0) + "%" : "?"}, short ${stats?.shortPercentOfFloat != null ? (stats.shortPercentOfFloat * 100).toFixed(1) + "% of float" : "?"}. ` +
        `Recent analyst moves: ${(stats?.ratingChanges || []).slice(0, 6).map((c) => `${c.firm} ${c.action} ${c.toGrade || ""}${c.targetTo ? " PT " + c.targetTo : ""}`).join("; ") || "none on file"}. ` +
        `Recent headlines: ${(news || []).slice(0, 8).map((n) => n.title.trim()).filter(Boolean).join(" | ") || "none"}.`;
      const SYSTEM =
        "Write a FactSet StreetAccount-style EARNINGS PREVIEW for the stock about to report — factual, concise, sell-side-desk voice, no hedging filler, no advice. Use BOTH the supplied data and your knowledge of the company. Fields: " +
        "'moneyLine' = ONE sentence: the single metric or guidance item that will decide the reaction. " +
        "'overview' = 1-2 sentences: the consensus the Street wants + how the stock is set up going in (positioning / bar high or low). " +
        "'watch' = 3-5 SPECIFIC items the Street is focused on THIS quarter — actual KPIs/segments/guidance lines for THIS company, never 'will they beat EPS'. " +
        "'guidance' = the company's standing guidance + expectation (raise/reaffirm/cut/first guide), or note if none. " +
        "'peerReads' = 2-3 recent reads from sector peers / suppliers / customers that already reported or pre-announced, and the implied read-through for this name (use the headlines + your knowledge; if none, return []). " +
        "'bull' = the bull case into the print; 'bear' = the bear case / what's priced in. " +
        "Use specific NUMBERS only from the supplied data; name segment/guidance items without fabricating precise figures. " +
        NO_ADVICE;
      const SCHEMA = 'Return ONLY JSON: {"moneyLine": string, "overview": string, "watch": string[], "guidance": string, "peerReads": string[], "bull": string, "bear": string}';
      // Live request → cap Gemini's reasoning so it returns well within the function timeout.
      const out = await chatJSON<any>(SYSTEM, ctx, { maxTokens: 4000, model: PRO_MODEL, reasoningEffort: "low" });
      const arr = (a: unknown) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && (x as string).trim()).map((x) => (x as string).trim()).slice(0, 6) : []);
      const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const ai = out && (s(out.overview) || s(out.moneyLine) || arr(out.watch).length)
        ? { moneyLine: s(out.moneyLine), overview: s(out.overview), watch: arr(out.watch), guidance: s(out.guidance), peerReads: arr(out.peerReads), bull: s(out.bull), bear: s(out.bear) }
        : null;
      return NextResponse.json({ ai }, { headers: { "Cache-Control": "public, s-maxage=10800, stale-while-revalidate=21600" } });
    }

    // ── Data part: reaction history + implied move + options skew/max-pain (fast, auto-loaded) ──
    const [reactions, emove, chain] = await Promise.all([
      getEarningsReactions(sym, 8).catch(() => []),
      loadEarningsMove().catch(() => null),
      getOptions(sym).catch(() => null),
    ]);
    const moves = (reactions || []).map((r) => r.move).filter((m): m is number => m != null);
    const reaction = moves.length
      ? { avgAbsMove: moves.reduce((a, m) => a + Math.abs(m), 0) / moves.length, maxAbsMove: Math.max(...moves.map(Math.abs)), upRate: moves.filter((m) => m > 0).length / moves.length, n: moves.length }
      : null;
    const events = (reactions || []).filter((r) => r.move != null).slice(0, 8).map((r) => ({ date: r.date, surprise: r.surprise, move: r.move }));
    const impliedMove = (emove?.rows || []).find((r) => r.symbol === sym)?.impliedMovePct ?? null;
    const options = optionsRead(chain);

    return NextResponse.json(
      { data: { reaction, events, impliedMove, options } },
      { headers: { "Cache-Control": "public, s-maxage=10800, stale-while-revalidate=21600" } },
    );
  } catch {
    return NextResponse.json(part === "ai" ? { ai: null } : { data: null });
  }
}
