import { NextResponse } from "next/server";
import { getCompanyStats } from "@/lib/companyStats";
import { getEarningsReactions } from "@/lib/earningsReaction";
import { loadEarningsMove } from "@/lib/earningsMove";
import { getOptions, getTermStructure, type OptionChain } from "@/lib/options";
import { getNews } from "@/lib/news";
import { getLatestTranscript } from "@/lib/transcripts";
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
  // OI walls — the heaviest open-interest strikes around spot. A big call wall above caps/pins
  // upside; a big put wall below acts as a magnet/support. Dealers hedge around them.
  let callWall: { strike: number; oi: number } | null = null;
  let putWall: { strike: number; oi: number } | null = null;
  for (const c of chain.calls) if (c.oi && c.strike >= u && (!callWall || c.oi > callWall.oi)) callWall = { strike: c.strike, oi: c.oi };
  for (const p of chain.puts) if (p.oi && p.strike <= u && (!putWall || p.oi > putWall.oi)) putWall = { strike: p.strike, oi: p.oi };
  return {
    expiry: chain.selected,
    atmIV: atmVals.length ? atmVals.reduce((a, b) => a + b, 0) / atmVals.length : null,
    skew: cIV != null && pIV != null ? pIV - cIV : null, // >0 = puts bid over calls (downside hedging)
    maxPain,
    maxPainVsSpot: maxPain ? maxPain / u - 1 : null,
    callWall,
    putWall,
  };
}

// IV term structure → expected vol-crush: the front (event) cycle's ATM IV vs a later cycle's. Event
// IV sits elevated into the print and collapses the morning after, so a front-rich (backwardated) term
// structure is the crush a premium-seller harvests. crushRatio = frontIV / backIV (>~1.1 = meaningful).
function termRead(ts: { points: { date: string; dte: number; atmIV: number | null }[] } | null) {
  if (!ts) return null;
  const pts = ts.points.filter((p) => p.atmIV != null && p.atmIV > 0 && p.dte >= 0).sort((a, b) => a.dte - b.dte);
  if (pts.length < 2) return null;
  const front = pts[0];
  const back = pts.find((p) => p.dte >= front.dte + 15) || pts[pts.length - 1]; // a genuinely later cycle
  if (back === front || back.atmIV == null || back.atmIV <= 0 || front.atmIV == null) return null;
  return { frontIV: front.atmIV, backIV: back.atmIV, frontDte: front.dte, backDte: back.dte, crushRatio: front.atmIV / back.atmIV };
}

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const part = new URL(req.url).searchParams.get("part") || "data";

  try {
    // ── AI part: the StreetAccount-style preview (button-triggered) ──
    if (part === "ai") {
      if (!(await llmConfigured())) return NextResponse.json({ ai: null });
      const [stats, news, transcript] = await Promise.all([
        getCompanyStats(sym).catch(() => null),
        getNews(sym, 8).catch(() => []),
        // The transcript scrape (Google News) can be slow/flaky — time-bound it so it never blows the
        // function budget; if it doesn't return fast, the preview just skips "since last call".
        Promise.race([
          getLatestTranscript(sym).catch(() => null),
          new Promise<null>((res) => setTimeout(() => res(null), 12000)),
        ]),
      ]);
      const q0 = stats?.estimates?.find((e) => e.period === "0q") || stats?.estimates?.[0];
      const revDir = q0 && q0.epsCurrent != null && q0.eps90dAgo != null ? (q0.epsCurrent > q0.eps90dAgo ? "rising" : q0.epsCurrent < q0.eps90dAgo ? "falling" : "flat") : "n/a";
      const dist = stats?.ratings ? `${stats.ratings.strongBuy + stats.ratings.buy} buy / ${stats.ratings.hold} hold / ${stats.ratings.sell + stats.ratings.strongSell} sell` : "n/a";
      const ctx =
        `Ticker ${sym}. Upcoming-quarter consensus: EPS ${q0?.epsAvg ?? "?"} (range ${q0?.epsLow ?? "?"}–${q0?.epsHigh ?? "?"}, ${q0?.epsAnalysts ?? "?"} analysts), revenue ${q0?.revAvg ? "$" + (q0.revAvg / 1e9).toFixed(2) + "B" : "?"}, YoY growth ${q0?.growth != null ? (q0.growth * 100).toFixed(0) + "%" : "?"}. ` +
        `EPS estimates ${revDir} (revisions ${q0?.epsUp30d ?? 0} up / ${q0?.epsDown30d ?? 0} down, 30d). Sell-side: ${dist}, mean PT ${stats?.targetMean ?? "?"} vs price ${stats?.price ?? "?"}. ` +
        `Valuation fwd P/E ${stats?.forwardPE?.toFixed(0) ?? "?"}, op margin ${stats?.operatingMargins != null ? (stats.operatingMargins * 100).toFixed(0) + "%" : "?"}, short ${stats?.shortPercentOfFloat != null ? (stats.shortPercentOfFloat * 100).toFixed(1) + "% of float" : "?"}. ` +
        `Recent analyst moves: ${(stats?.ratingChanges || []).slice(0, 6).map((c) => `${c.firm} ${c.action} ${c.toGrade || ""}${c.targetTo ? " PT " + c.targetTo : ""}`).join("; ") || "none on file"}. ` +
        `Recent headlines: ${(news || []).slice(0, 8).map((n) => n.title.trim()).filter(Boolean).join(" | ") || "none"}.` +
        (transcript?.text && transcript.text.length > 1000 ? `\n\nMOST RECENT EARNINGS CALL (${transcript.date || "prior quarter"} — ${transcript.title}):\n${transcript.text.slice(0, 9000)}` : "");
      const SYSTEM =
        "Write a FactSet StreetAccount-style EARNINGS PREVIEW for the stock about to report — factual, concise, sell-side-desk voice, no hedging filler, no advice. Use BOTH the supplied data and your knowledge of the company. Fields: " +
        "'moneyLine' = ONE sentence: the single metric or guidance item that will decide the reaction. " +
        "'overview' = 1-2 sentences: the consensus the Street wants + how the stock is set up going in (positioning / bar high or low). " +
        "'watch' = 3-5 SPECIFIC items the Street is focused on THIS quarter — actual KPIs/segments/guidance lines for THIS company, never 'will they beat EPS'. " +
        "'guidance' = the company's standing guidance + expectation (raise/reaffirm/cut/first guide), or note if none. " +
        "'peerReads' = 2-3 recent reads from sector peers / suppliers / customers that already reported or pre-announced, and the implied read-through for this name (use the headlines + your knowledge; if none, return []). " +
        "'bull' = the bull case into the print; 'bear' = the bear case / what's priced in. " +
        "'fromLastCall' = if a MOST RECENT EARNINGS CALL transcript is supplied below, 1-2 sentences on what management SAID or COMMITTED to last call (guidance given, targets, tone, promises) + the ONE thing to check for follow-through THIS print; if no transcript is supplied, return ''. " +
        "Use specific NUMBERS only from the supplied data; name segment/guidance items without fabricating precise figures. " +
        NO_ADVICE;
      const SCHEMA = 'Return ONLY JSON: {"moneyLine": string, "overview": string, "watch": string[], "guidance": string, "peerReads": string[], "bull": string, "bear": string, "fromLastCall": string}';
      // Live request → cap Gemini's reasoning so it returns well within the function timeout.
      const out = await chatJSON<any>(SYSTEM, ctx, { maxTokens: 4000, model: PRO_MODEL, reasoningEffort: "low" });
      const arr = (a: unknown) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && (x as string).trim()).map((x) => (x as string).trim()).slice(0, 6) : []);
      const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
      const ai = out && (s(out.overview) || s(out.moneyLine) || arr(out.watch).length)
        ? { moneyLine: s(out.moneyLine), overview: s(out.overview), watch: arr(out.watch), guidance: s(out.guidance), peerReads: arr(out.peerReads), bull: s(out.bull), bear: s(out.bear), fromLastCall: s(out.fromLastCall) }
        : null;
      return NextResponse.json({ ai }, { headers: { "Cache-Control": "public, s-maxage=10800, stale-while-revalidate=21600" } });
    }

    // ── Data part: reaction history + implied move + options skew/max-pain (fast, auto-loaded) ──
    const [reactions, emove, chain, ts] = await Promise.all([
      getEarningsReactions(sym, 8).catch(() => []),
      loadEarningsMove().catch(() => null),
      getOptions(sym).catch(() => null),
      getTermStructure(sym, 6).catch(() => null),
    ]);
    const term = termRead(ts);
    const moves = (reactions || []).map((r) => r.move).filter((m): m is number => m != null);
    const reaction = moves.length
      ? { avgAbsMove: moves.reduce((a, m) => a + Math.abs(m), 0) / moves.length, maxAbsMove: Math.max(...moves.map(Math.abs)), upRate: moves.filter((m) => m > 0).length / moves.length, n: moves.length }
      : null;
    const events = (reactions || []).filter((r) => r.move != null).slice(0, 8).map((r) => ({ date: r.date, surprise: r.surprise, move: r.move, drift5: r.drift5 }));
    const impliedMove = (emove?.rows || []).find((r) => r.symbol === sym)?.impliedMovePct ?? null;
    const options = optionsRead(chain);

    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    // Straddle "win-rate": of past prints, how often the realized move EXCEEDED what options price now.
    const straddleWinRate = impliedMove != null && moves.length ? { exceeded: moves.filter((m) => Math.abs(m) > impliedMove / 100).length, total: moves.length } : null;
    // PEAD: post-earnings 5-day drift after beats vs misses + follow-through rate (drift same sign as the day-1 move).
    const withDrift = (reactions || []).filter((r) => r.drift5 != null) as { move: number | null; surprise: number | null; drift5: number }[];
    const beatDrift = withDrift.filter((r) => r.surprise != null && r.surprise > 0).map((r) => r.drift5);
    const missDrift = withDrift.filter((r) => r.surprise != null && r.surprise <= 0).map((r) => r.drift5);
    const ftSet = withDrift.filter((r) => r.move != null);
    const pead = ftSet.length >= 3
      ? { avgBeatDrift5: avg(beatDrift), avgMissDrift5: avg(missDrift), followThrough: ftSet.filter((r) => Math.sign(r.move!) === Math.sign(r.drift5)).length / ftSet.length, n: ftSet.length }
      : null;

    // Options rich/cheap (implied vs avg REALIZED move) + the straddle breakevens.
    const price = chain?.underlying ?? null;
    const avgRealized = reaction ? reaction.avgAbsMove * 100 : null; // %
    const richness =
      impliedMove != null && avgRealized != null && avgRealized > 0
        ? { ratio: impliedMove / avgRealized, verdict: impliedMove / avgRealized >= 1.2 ? "rich" : impliedMove / avgRealized <= 0.85 ? "cheap" : "fair", avgRealized }
        : null;
    const straddle =
      impliedMove != null && price
        ? { cost: (price * impliedMove) / 100, upperBE: price * (1 + impliedMove / 100), lowerBE: price * (1 - impliedMove / 100), price }
        : null;

    return NextResponse.json(
      { data: { reaction, events, impliedMove, options, richness, straddle, straddleWinRate, pead, term } },
      { headers: { "Cache-Control": "public, s-maxage=10800, stale-while-revalidate=21600" } },
    );
  } catch {
    return NextResponse.json(part === "ai" ? { ai: null } : { data: null });
  }
}
