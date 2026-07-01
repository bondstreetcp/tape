import { NextResponse } from "next/server";
import { getCompanyStats } from "@/lib/companyStats";
import { getEarningsReactions } from "@/lib/earningsReaction";
import { getFilings, getFilingText } from "@/lib/edgar";
import { loadEarningsMove } from "@/lib/earningsMove";
import { getOptions, getTermStructure, type OptionChain, type Opt } from "@/lib/options";
import { straddleMove, tradeIdea } from "@/lib/earningsTrade";
import { peerCohort } from "@/lib/peerCohorts";
import YahooFinance from "yahoo-finance2";
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

// Compact strike ladder (~15 strikes around ATM) from the EVENT chain + context — feeds the client-side
// IV-crush scenario tool (components/IvCrushScenario), which reprices with Black-Scholes as the user
// drags a vol-crush slider. Sent once; all the interactivity (IV solved from premium) is client-side.
function ivScenarioFrom(
  sm: { price: number; atmStrike: number; expiry: string | null; dte: number | null; chain: OptionChain } | null,
  chain: OptionChain | null,
  term: { crushRatio: number } | null,
) {
  const src = sm?.chain ?? chain;
  if (!src?.underlying || (!src.calls.length && !src.puts.length)) return null;
  const S = sm?.price ?? src.underlying;
  const strikes = [...new Set([...src.calls, ...src.puts].map((o) => o.strike))].sort((a, b) => a - b);
  if (strikes.length < 5) return null;
  // Nearest LISTED strike to spot — re-derive from the strike set so the ATM is always in the ladder
  // (sm.atmStrike can be a float that isn't an exact set member → indexOf -1 → a mis-centered slice).
  const atm = strikes.reduce((a, b) => (Math.abs(b - S) < Math.abs(a - S) ? b : a));
  const ai = strikes.indexOf(atm);
  const lo = Math.max(0, ai - 7), hi = Math.min(strikes.length, ai + 8);
  const mid = (o: Opt | undefined): number | null =>
    o && o.bid != null && o.ask != null && o.bid > 0 && o.ask > 0 ? (o.bid + o.ask) / 2 : o?.last != null && o.last > 0 ? o.last : null;
  const ladder = strikes
    .slice(lo, hi)
    .map((k) => {
      const c = src.calls.find((o) => o.strike === k), p = src.puts.find((o) => o.strike === k);
      return { k, cMid: mid(c), cIV: c?.iv ?? null, pMid: mid(p), pIV: p?.iv ?? null };
    })
    .filter((r) => r.cMid != null || r.pMid != null);
  if (ladder.length < 4) return null;
  const expectedCrushPct = term && term.crushRatio > 1 ? Math.round((1 - 1 / term.crushRatio) * 100) : null;
  return { spot: S, atmStrike: atm, expiry: sm?.expiry ?? src.selected, dteNow: sm?.dte ?? null, expectedCrushPct, ladder };
}

// Pull the actual 8-K item-2.02 earnings PRESS RELEASE for a specific past print — the primary source
// that turns "likely guidance" into the real guidance/segment figures. Returns a focused excerpt
// (headline results + the outlook/guidance window) or null if there's no matching 8-K / the fetch fails.
function releaseExcerpt(text: string): string {
  const head = text.slice(0, 6000);
  const kw = /(outlook|guidance|full[- ]?year|fiscal\s*20\d\d|we (?:now )?expect|expects?|anticipat|rais(?:e|ing|ed)|lower(?:ed|ing)?|reaffirm|updat(?:e|ed|ing)\s+(?:its\s+)?(?:guidance|outlook)|for the (?:full year|year))/i;
  const rest = text.slice(6000);
  const m = rest.search(kw);
  const guide = m >= 0 ? rest.slice(Math.max(0, m - 200), m + 3800) : "";
  return (guide ? `${head}\n…\n[OUTLOOK / GUIDANCE SECTION]\n${guide}` : head).slice(0, 11000);
}
async function earningsReleaseText(sym: string, dISO: string): Promise<{ text: string; url: string; date: string } | null> {
  try {
    const eT = Date.parse(dISO);
    const { filings } = await getFilings(sym, 0, 100);
    const earn = filings.filter((f) => f.isEarnings); // 8-K item 2.02 (Results of Operations)
    let best: (typeof earn)[number] | null = null, bestGap = Infinity;
    for (const f of earn) { const g = Math.abs(Date.parse(f.date) - eT); if (g < bestGap) { bestGap = g; best = f; } }
    if (!best || bestGap > 6 * 86_400_000) return null; // no earnings 8-K within ±6 days of the print
    const doc = await getFilingText(sym, best.acc);
    if (!doc?.text || doc.text.length < 400) return null;
    return { text: releaseExcerpt(doc.text), url: doc.url, date: best.date };
  } catch {
    return null;
  }
}

const yf = new YahooFinance({ suppressNotices: ["yahooSurvey"] } as any);

// ~2yr of daily closes (dated) — for the realized-vol regime + the peer-sympathy day lookups.
async function dailyCloses(sym: string): Promise<{ t: number; c: number }[]> {
  try {
    const chart: any = await yf.chart(sym, { period1: new Date(Date.now() - 760 * 86_400_000), interval: "1d" } as any, { validateResult: false });
    return (chart.quotes || []).filter((q: any) => q?.date && q.close != null).map((q: any) => ({ t: new Date(q.date).getTime(), c: q.close as number })).sort((a: any, b: any) => a.t - b.t);
  } catch {
    return [];
  }
}

// Quantified peer read-through (sympathy): when a cohort peer reported in the past, how did THIS stock
// move that day? Returns, per peer: avg |this stock's same-day move|, the slope (beta) of this stock's
// move on the peer's move, and the same-direction rate. A peer printing before this name is a live prior.
async function peerReadThrough(sym: string, myCloses: { t: number; c: number }[]) {
  const cohort = peerCohort(sym);
  if (!cohort || myCloses.length < 60) return null;
  const dayMove = new Map<string, number>(); // YYYY-MM-DD → this stock's close-to-close move that session
  for (let i = 1; i < myCloses.length; i++) dayMove.set(new Date(myCloses[i].t).toISOString().slice(0, 10), myCloses[i].c / myCloses[i - 1].c - 1);
  const peers = cohort.tickers.filter((t) => t !== sym).slice(0, 4);
  const out = await Promise.all(peers.map(async (p) => {
    const pr = await getEarningsReactions(p, 8).catch(() => []);
    const pairs: { peer: number; me: number }[] = [];
    for (const e of pr) { if (e.move == null) continue; const me = dayMove.get(e.reactionDate); if (me != null) pairs.push({ peer: e.move, me }); }
    if (pairs.length < 3) return null;
    const avgAbsMe = pairs.reduce((a, x) => a + Math.abs(x.me), 0) / pairs.length;
    const mp = pairs.reduce((a, x) => a + x.peer, 0) / pairs.length, mm = pairs.reduce((a, x) => a + x.me, 0) / pairs.length;
    let cov = 0, vp = 0; for (const x of pairs) { cov += (x.peer - mp) * (x.me - mm); vp += (x.peer - mp) ** 2; }
    const beta = vp > 0 ? cov / vp : null;
    const sameDir = pairs.filter((x) => Math.sign(x.peer) === Math.sign(x.me) && x.peer !== 0).length / pairs.length;
    return { sym: p, n: pairs.length, avgAbsMe, beta, sameDir };
  }));
  const list = out.filter((x): x is NonNullable<typeof x> => !!x).sort((a, b) => b.avgAbsMe - a.avgAbsMe);
  return list.length ? list : null;
}

// Vol regime: is the event IV rich in ABSOLUTE terms? ATM IV vs trailing realized (historical) vol +
// where current 20d HV sits in its own 1yr range. (Options rich/cheap compares IV to the realized MOVE;
// this compares IV to day-to-day realized vol — the variance-risk-premium view.)
function volRegimeFrom(closes: number[], atmIV: number | null) {
  if (atmIV == null || closes.length < 40) return null;
  const rets: number[] = [];
  for (let i = 1; i < closes.length; i++) rets.push(Math.log(closes[i] / closes[i - 1]));
  const ann = (r: number[]) => { if (r.length < 5) return null; const m = r.reduce((a, b) => a + b, 0) / r.length; const sd = Math.sqrt(r.reduce((a, b) => a + (b - m) ** 2, 0) / r.length); return sd * Math.sqrt(252); };
  const hv20 = ann(rets.slice(-20));
  if (hv20 == null || hv20 <= 0) return null;
  const roll: number[] = [];
  for (let i = 20; i <= rets.length; i++) { const v = ann(rets.slice(i - 20, i)); if (v != null) roll.push(v); }
  const hvPctile = roll.length ? (roll.filter((v) => v <= hv20).length / roll.length) * 100 : null;
  return { atmIV, hv20, ivHvRatio: atmIV / hv20, hvPctile };
}

// The earnings trade idea + the live straddle-implied move live in lib/earningsTrade.ts — shared with the
// nightly trade-log (scripts/refresh-trade-log.ts) so the LOGGED play is the exact one the card shows.
// tradeIdea prices its legs on the SAME (event) expiry as the straddle and reports that expiry/dte.

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const sp = new URL(req.url).searchParams;
  const part = sp.get("part") || "data";
  const earningsISO = (() => { const e = sp.get("e"); return e && /^\d{4}-\d{2}-\d{2}/.test(e) ? e.slice(0, 10) : null; })();

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
      const sig = sp.get("sig"); // the card's computed quant signals, passed by the component
      const q0 = stats?.estimates?.find((e) => e.period === "0q") || stats?.estimates?.[0];
      const revDir = q0 && q0.epsCurrent != null && q0.eps90dAgo != null ? (q0.epsCurrent > q0.eps90dAgo ? "rising" : q0.epsCurrent < q0.eps90dAgo ? "falling" : "flat") : "n/a";
      const dist = stats?.ratings ? `${stats.ratings.strongBuy + stats.ratings.buy} buy / ${stats.ratings.hold} hold / ${stats.ratings.sell + stats.ratings.strongSell} sell` : "n/a";
      const ctx =
        `Ticker ${sym}. Upcoming-quarter consensus: EPS ${q0?.epsAvg ?? "?"} (range ${q0?.epsLow ?? "?"}–${q0?.epsHigh ?? "?"}, ${q0?.epsAnalysts ?? "?"} analysts), revenue ${q0?.revAvg ? "$" + (q0.revAvg / 1e9).toFixed(2) + "B" : "?"}, YoY growth ${q0?.growth != null ? (q0.growth * 100).toFixed(0) + "%" : "?"}. ` +
        `EPS estimates ${revDir} (revisions ${q0?.epsUp30d ?? 0} up / ${q0?.epsDown30d ?? 0} down, 30d). Sell-side: ${dist}, mean PT ${stats?.targetMean ?? "?"} vs price ${stats?.price ?? "?"}. ` +
        `Valuation fwd P/E ${stats?.forwardPE?.toFixed(0) ?? "?"}, op margin ${stats?.operatingMargins != null ? (stats.operatingMargins * 100).toFixed(0) + "%" : "?"}, short ${stats?.shortPercentOfFloat != null ? (stats.shortPercentOfFloat * 100).toFixed(1) + "% of float" : "?"}. ` +
        `Recent analyst moves: ${(stats?.ratingChanges || []).slice(0, 6).map((c) => `${c.firm} ${c.action} ${c.toGrade || ""}${c.targetTo ? " PT " + c.targetTo : ""}`).join("; ") || "none on file"}. ` +
        `Recent headlines: ${(news || []).slice(0, 8).map((n) => n.title.trim()).filter(Boolean).join(" | ") || "none"}.` +
        (sig ? `\n\nQUANT SIGNALS — this terminal's own options + reaction-history analysis (GROUND the preview in the notable ones; synthesize, don't just restate): ${sig.slice(0, 1400)}` : "") +
        (transcript?.text && transcript.text.length > 1000 ? `\n\nMOST RECENT EARNINGS CALL (${transcript.date || "prior quarter"} — ${transcript.title}):\n${transcript.text.slice(0, 9000)}` : "");
      const SYSTEM =
        "Write a FactSet StreetAccount-style EARNINGS PREVIEW for the stock about to report — factual, concise, sell-side-desk voice, no hedging filler, no advice. Use BOTH the supplied data and your knowledge of the company. Fields: " +
        "'moneyLine' = ONE sentence: the single metric or guidance item that will decide the reaction. " +
        "'overview' = 1-2 sentences: the consensus the Street wants + how the stock is set up going in (positioning / bar high or low). " +
        "'watch' = 3-5 SPECIFIC items the Street is focused on THIS quarter — actual KPIs/segments/guidance lines for THIS company, never 'will they beat EPS'. " +
        "'guidance' = the company's standing guidance + expectation (raise/reaffirm/cut/first guide), or note if none. " +
        "'peerReads' = 2-3 recent reads from sector peers / suppliers / customers that already reported or pre-announced, and the implied read-through for this name (use the headlines + your knowledge; if none, return []). " +
        "'bull' = the bull case into the print; 'bear' = the bear case / what's priced in. " +
        "If QUANT SIGNALS are supplied below, GROUND moneyLine/overview/bull/bear in the notable ones — e.g. options pricing a rich vs cheap move, a sell-the-news reaction pattern, post-earnings drift, a sandbagging guidance history, vol-crush — woven naturally into the narrative, NOT as a bullet dump. " +
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

    // ── "Why" part: explain a SINGLE past print's reaction (clicked from the reactions table) ──
    // e.g. "beat EPS but fell 18% — why?". Grounded in the reaction facts + headlines dated near the
    // print; the LLM is hard-gated against fabricating specifics it can't support (esp. recent quarters).
    if (part === "why") {
      const dISO = (() => { const dd = sp.get("d"); return dd && /^\d{4}-\d{2}-\d{2}/.test(dd) ? dd.slice(0, 10) : null; })();
      if (!dISO || !(await llmConfigured())) return NextResponse.json({ why: null });
      const [reactions, news, release] = await Promise.all([
        getEarningsReactions(sym, 8).catch(() => []),
        getNews(sym, 30).catch(() => []),
        earningsReleaseText(sym, dISO).catch(() => null), // the actual 8-K press release (primary source)
      ]);
      const eT = Date.parse(dISO);
      let rx: (typeof reactions)[number] | null = null, bestGap = Infinity;
      for (const r of reactions) { const g = Math.abs(Date.parse(r.date) - eT); if (g < bestGap) { bestGap = g; rx = r; } }
      // Only headlines dated within ±10 days of the print are actually about that quarter (recent-news
      // noise for an old quarter would MISLEAD) — for old prints this is usually empty, which is honest.
      const near = (news || []).filter((n) => n.time && Math.abs(Date.parse(n.time) - eT) <= 10 * 86_400_000).slice(0, 6);
      const qLabel = new Date(dISO + "T00:00:00Z").toLocaleDateString("en-US", { month: "long", year: "numeric" });
      const s2 = (v: number | null | undefined, d = 0) => (v == null ? "n/a" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`);
      const contradiction = rx && rx.surprise != null && rx.move != null
        ? rx.surprise > 0 && rx.move < 0 ? "The stock BEAT on EPS but FELL — the reaction was driven by something other than headline EPS."
          : rx.surprise < 0 && rx.move > 0 ? "The stock MISSED on EPS but ROSE — the reaction was driven by something other than headline EPS."
          : "" : "";
      const ctx =
        `Ticker ${sym}. Earnings reported around ${qLabel} (${dISO}). ` +
        `EPS surprise vs consensus: ${s2(rx?.surprise)}. One-day price reaction: ${s2(rx?.move, 1)}. Post-print 5-session drift: ${s2(rx?.drift5, 1)}. ${contradiction} ` +
        (near.length ? `\n\nHeadlines dated near the report:\n${near.map((n) => `- ${n.title} (${n.publisher})`).join("\n")}` : `\n\n(No headlines dated near this report are available.)`) +
        (release?.text ? `\n\nEARNINGS PRESS RELEASE excerpt (8-K item 2.02 filed ${release.date} — the PRIMARY SOURCE; results highlights + the outlook/guidance section):\n"""\n${release.text}\n"""` : "");
      const SYSTEM =
        "You explain WHY a stock moved the way it did after ONE specific past earnings report, for a professional investor. " +
        "When EPS beat but the stock fell (or missed but rose), the driver is almost always something OTHER than headline EPS — identify the single most likely one: forward GUIDANCE (cut/raise), a key SEGMENT or KPI, GROSS/OPERATING MARGIN, a PIPELINE/REGULATORY/one-time item, BUYBACK/dividend, or MACRO/positioning (a 'sell-the-news' unwind after a run-up). " +
        "If an EARNINGS PRESS RELEASE excerpt is provided below, it is the PRIMARY SOURCE — base your answer on it and CITE the specific guidance range, segment, or margin figure that explains the reaction (quote the actual numbers from it, e.g. 'guided FY26 organic sales to +1-2%, below the ~3% Street'). When grounded in the release you may use 'high' or 'medium' confidence. Be specific and concise: 1-3 sentences. " +
        "CRITICAL ANTI-FABRICATION RULE: if NO press release is provided AND you do NOT have reliable specific knowledge of THIS exact report (very recent quarters after your training, or any you're unsure of), DO NOT invent a driver, numbers, or events — set confidence 'low', say plainly the specific catalyst isn't confirmed from the data here, and explain what the beat-but-fell / miss-but-rose pattern IMPLIES about what the market focused on. Never fabricate figures. " +
        NO_ADVICE;
      const SCHEMA = 'Return ONLY JSON: {"why": string, "confidence": "high"|"medium"|"low"}';
      const out = await chatJSON<{ why?: string; confidence?: string }>(SYSTEM, ctx + "\n\n" + SCHEMA, { maxTokens: 1600, model: PRO_MODEL, reasoningEffort: "low" });
      const why = out && typeof out.why === "string" && out.why.trim() ? out.why.trim() : null;
      return NextResponse.json(
        {
          why,
          confidence: out?.confidence ?? null,
          grounded: !!release?.text, // whether the recap is backed by the actual 8-K release
          filing: release ? { url: release.url, date: release.date } : null,
          headlines: near.map((n) => ({ title: n.title, publisher: n.publisher, link: n.link, time: n.time })),
          fact: rx ? { surprise: rx.surprise, move: rx.move, drift5: rx.drift5, timing: rx.timing } : null,
        },
        { headers: { "Cache-Control": "public, s-maxage=86400, stale-while-revalidate=172800" } },
      );
    }

    // ── Data part: reaction history + implied move + options skew/max-pain (fast, auto-loaded) ──
    const [reactions, emove, chain, ts, closes] = await Promise.all([
      getEarningsReactions(sym, 8).catch(() => []),
      loadEarningsMove().catch(() => null),
      getOptions(sym).catch(() => null),
      getTermStructure(sym, 6).catch(() => null),
      dailyCloses(sym),
    ]);
    const term = termRead(ts);
    const moves = (reactions || []).map((r) => r.move).filter((m): m is number => m != null);
    const reaction = moves.length
      ? { avgAbsMove: moves.reduce((a, m) => a + Math.abs(m), 0) / moves.length, maxAbsMove: Math.max(...moves.map(Math.abs)), upRate: moves.filter((m) => m > 0).length / moves.length, n: moves.length }
      : null;
    const events = (reactions || []).filter((r) => r.move != null).slice(0, 8).map((r) => ({ date: r.date, surprise: r.surprise, move: r.move, drift5: r.drift5, timing: r.timing }));
    // Typical reporting timing (the company's own pattern) → when the NEXT print's move lands: before-open
    // reporters move that session, after-close reporters move the next session.
    const tg = (reactions || []).map((r) => r.timing);
    const nextTiming: "bmo" | "amc" | null = tg.length ? (tg.filter((t) => t === "amc").length >= tg.length / 2 ? "amc" : "bmo") : null;
    // Implied move: PREFER the live ATM-straddle cost from the chain (works for any name, always fresh);
    // fall back to the precomputed earnings-move file when there's no usable chain.
    const sm = await straddleMove(sym, chain, earningsISO);
    const impliedMove = sm?.movePct ?? (emove?.rows || []).find((r) => r.symbol === sym)?.impliedMovePct ?? null;
    // The straddle ≈ the EARNINGS move only when we picked the expiry bracketing earnings AND it's near
    // (a far-out straddle is mostly time value, not the event) — so the rich/cheap-vs-1-day-reaction
    // comparison is gated on that. The precomputed-file fallback (sm==null) is already an ≤16d event move.
    const nearTerm = !sm ? true : sm.isEvent && (sm.dte == null || sm.dte <= 21);
    const options = optionsRead(chain);

    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
    // Straddle "win-rate": of past prints, how often the realized move EXCEEDED what options price now.
    const straddleWinRate = nearTerm && impliedMove != null && moves.length ? { exceeded: moves.filter((m) => Math.abs(m) > impliedMove / 100).length, total: moves.length } : null;
    // PEAD: post-earnings 5-day drift after beats vs misses + follow-through rate (drift same sign as the day-1 move).
    const withDrift = (reactions || []).filter((r) => r.drift5 != null) as { move: number | null; surprise: number | null; drift5: number }[];
    const beatDrift = withDrift.filter((r) => r.surprise != null && r.surprise > 0).map((r) => r.drift5);
    const missDrift = withDrift.filter((r) => r.surprise != null && r.surprise <= 0).map((r) => r.drift5);
    const ftSet = withDrift.filter((r) => r.move != null);
    const pead = ftSet.length >= 3
      ? { avgBeatDrift5: avg(beatDrift), avgMissDrift5: avg(missDrift), followThrough: ftSet.filter((r) => Math.sign(r.move!) === Math.sign(r.drift5)).length / ftSet.length, n: ftSet.length }
      : null;

    // Reaction reliability: does a beat actually mean UP (sell-the-news), and a miss mean DOWN? The
    // DIRECTIONAL hit-rate is robust at small n (Yahoo keeps ~4 surprises); a fitted slope/intercept is
    // not, so we don't report one. Complements the beats/misses AVERAGE (which shows magnitude, not consistency).
    const srP = (reactions || []).filter((r) => r.surprise != null && r.move != null).map((r) => ({ x: r.surprise as number, y: r.move as number }));
    const surpriseReaction = (() => {
      const beats = srP.filter((p) => p.x > 0), misses = srP.filter((p) => p.x < 0);
      if (beats.length < 3 && misses.length < 3) return null;
      return {
        n: srP.length,
        beatUp: beats.length ? beats.filter((p) => p.y > 0).length / beats.length : null, beatN: beats.length,
        missDown: misses.length ? misses.filter((p) => p.y < 0).length / misses.length : null, missN: misses.length,
      };
    })();

    // Options rich/cheap (implied vs avg REALIZED move) + the straddle breakevens.
    const price = chain?.underlying ?? null;
    const avgRealized = reaction ? reaction.avgAbsMove * 100 : null; // %
    const richness =
      nearTerm && impliedMove != null && avgRealized != null && avgRealized > 0
        ? { ratio: impliedMove / avgRealized, verdict: impliedMove / avgRealized >= 1.2 ? "rich" : impliedMove / avgRealized <= 0.85 ? "cheap" : "fair", avgRealized }
        : null;
    // Straddle breakevens + cost: the REAL straddle when we have the live chain (with its expiry/DTE),
    // else derived from the implied-move % and spot.
    const straddle = sm
      ? { cost: sm.cost, upperBE: sm.upperBE, lowerBE: sm.lowerBE, price: sm.price, expiry: sm.expiry, dte: sm.dte, live: true }
      : impliedMove != null && price
        ? { cost: (price * impliedMove) / 100, upperBE: price * (1 + impliedMove / 100), lowerBE: price * (1 - impliedMove / 100), price, expiry: null, dte: null, live: false }
        : null;
    const volRegime = volRegimeFrom(closes.map((x) => x.c), options?.atmIV ?? null);
    // Price the legs on the SAME expiry the straddle used (the one bracketing earnings), not the nearest
    // chain — so the suggested strikes and their premiums are internally consistent with the implied move.
    const trade = tradeIdea(richness, options, straddle, sm?.chain ?? chain, impliedMove);
    // Strike ladder for the interactive IV-crush scenario matrix (client reprices via Black-Scholes).
    const ivScenario = ivScenarioFrom(sm, chain, term);
    // Should you BUY premium (calls/puts/straddle) into the print? Even a right directional call loses if
    // the move comes in UNDER the priced move and the IV crushes. Synthesize: how often the realized move
    // cleared the implied (incl. CONDITIONAL on a beat — the call-buyer's case), + rich/cheap + the crush.
    const longPremium = (() => {
      if (!nearTerm || impliedMove == null) return null;
      const im = impliedMove / 100;
      const beats = (reactions || []).filter((r) => r.surprise != null && r.surprise > 0 && r.move != null);
      const beatClear = beats.filter((r) => (r.move as number) > im).length; // beat AND rose MORE than priced
      const clearRate = straddleWinRate && straddleWinRate.total ? straddleWinRate.exceeded / straddleWinRate.total : null;
      const richV = richness?.verdict;
      let verdict: "favorable" | "neutral" | "unfavorable" = "neutral";
      if (richV === "cheap" && (clearRate == null || clearRate >= 0.45)) verdict = "favorable";
      else if (richV === "rich" || (clearRate != null && clearRate <= 0.4)) verdict = "unfavorable";
      return { verdict, beatClear, beatN: beats.length, crushRatio: term?.crushRatio ?? null };
    })();
    const peerSympathy = await peerReadThrough(sym, closes);
    // Recent price series (compact [t,c] tuples) for the expected-move cone visual.
    const priceSeries = closes.slice(-55).map((x) => [x.t, Math.round(x.c * 100) / 100] as [number, number]);

    return NextResponse.json(
      { data: { reaction, events, impliedMove, options, richness, straddle, straddleWinRate, pead, term, nextTiming, volRegime, trade, peerSympathy, surpriseReaction, priceSeries, longPremium, ivScenario } },
      { headers: { "Cache-Control": "public, s-maxage=10800, stale-while-revalidate=21600" } },
    );
  } catch {
    return NextResponse.json(part === "ai" ? { ai: null } : { data: null });
  }
}
