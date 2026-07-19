/**
 * The AI EARNINGS PREVIEW engine — context assembly + the two model passes — extracted from
 * app/api/earnings-prep/[symbol]/route.ts so the LIVE route (part=ai) and the NIGHTLY predicted-print
 * logger (scripts/refresh-earnings-preview-log.ts) share ONE code path (the earningsTrade precedent:
 * a logged record only means something if it's exactly what the live surface computes).
 *
 * Two model passes over the SAME assembled context:
 *  - buildAiPreview (PRO): the StreetAccount-style narrative — now with an explicitly QUALITATIVE
 *    thesis + debate ("what will they actually report about, what's genuinely contested"), fed by the
 *    company's own words (guidance quote, prior 8-K release language, last call transcript).
 *  - predictPrint (FLASH): the desk's OWN FORECAST of the print — predicted EPS/revenue, beat/miss
 *    call, reaction direction, and 2-4 checkable qualitative calls. This is the one place the model is
 *    ASKED to estimate numbers: a forecast labelled as a forecast, logged BEFORE the print and graded
 *    by code against actuals afterward ("code verifies, models propose").
 *
 * SERVER-ONLY (network + fs via earningsQuant). Never import from a "use client" file.
 */
import { cachedStats } from "./companyCache";
import { getNews } from "./news";
import { getLatestTranscript } from "./transcripts";
import { getEarningsReactions } from "./earningsReaction";
import { getFilings, getFilingText } from "./edgar";
import { chatJSON, NO_ADVICE, PRO_MODEL, FLASH_MODEL } from "./llm";
import { computeQuant, buildSig, loadGuidance, loadSss, type QuantResult } from "./earningsQuant";
import type { CompanyStats } from "./companyStats";

/** Race a live sub-fetch against a timeout so one slow source (the NAS home uplink) can't stall the
 *  whole preview — returns `fallback` if `p` doesn't settle within `ms`. */
export function raceTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return Promise.race([p, new Promise<T>((res) => setTimeout(() => res(fallback), ms))]);
}

// Pull the actual 8-K item-2.02 earnings PRESS RELEASE for a specific past print — the primary source
// that turns "likely guidance" into the real guidance/segment figures. Returns a focused excerpt
// (headline results + the outlook/guidance window) or null if there's no matching 8-K / the fetch fails.
export function releaseExcerpt(text: string): string {
  const head = text.slice(0, 6000);
  const kw = /(outlook|guidance|full[- ]?year|fiscal\s*20\d\d|we (?:now )?expect|expects?|anticipat|rais(?:e|ing|ed)|lower(?:ed|ing)?|reaffirm|updat(?:e|ed|ing)\s+(?:its\s+)?(?:guidance|outlook)|for the (?:full year|year))/i;
  const rest = text.slice(6000);
  const m = rest.search(kw);
  const guide = m >= 0 ? rest.slice(Math.max(0, m - 200), m + 3800) : "";
  return (guide ? `${head}\n…\n[OUTLOOK / GUIDANCE SECTION]\n${guide}` : head).slice(0, 11000);
}
export async function earningsReleaseText(sym: string, dISO: string): Promise<{ text: string; url: string; date: string } | null> {
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

export interface PreviewContext {
  sym: string;
  stats: CompanyStats | null;
  quant: QuantResult | null;
  sig: string;
  consEps: number | null; // upcoming-quarter consensus EPS at assembly time — the bar the prediction is graded against
  consRevB: number | null; // consensus revenue, $B
  ctx: string; // the assembled prompt context both model passes consume
}

/** Assemble everything both model passes need — every live sub-fetch time-bound (the NAS has no
 *  platform function ceiling; see the route). One assembly, two prompts. */
export async function assemblePreviewContext(sym: string, earningsISO: string | null): Promise<PreviewContext> {
  const [stats, news, transcript, quant, priorRelease] = await Promise.all([
    // Cache-first (local file for baked names); the live fallback on a cold/off-index name is one
    // Yahoo call — bound it like the rest.
    raceTimeout(cachedStats(sym).catch(() => null), 10_000, null),
    raceTimeout(getNews(sym, 8).catch(() => []), 12_000, [] as Awaited<ReturnType<typeof getNews>>),
    // The transcript scrape (Google News) can be slow/flaky — if it doesn't return fast, the
    // preview just skips "since last call".
    raceTimeout(getLatestTranscript(sym).catch(() => null), 12_000, null),
    // Options chain + term structure + reactions — several Yahoo calls; degrade to a quant-less
    // preview rather than stalling it.
    raceTimeout(computeQuant(sym, earningsISO).catch(() => null), 20_000, null),
    // The PRIOR print's 8-K release — the company's own outlook language + segment framing. INSIDE the
    // parallel batch (its own reactions call anchors the date rather than waiting on computeQuant), so
    // the whole assembly keeps the ≤20s budget — stacking this sequentially after the batch broke the
    // route's ≲60s wall-clock ceiling (20s prefetch + 40s LLM race), the 71075cb8 invariant.
    // earningsReleaseText matches the nearest earnings 8-K within ±6d, so the anchor needn't be exact.
    raceTimeout(
      getEarningsReactions(sym, 1)
        .then((r) => (r[0]?.date ? earningsReleaseText(sym, r[0].date) : null))
        .catch(() => null),
      20_000,
      null,
    ),
  ]);
  const guid = loadGuidance(sym);
  const sss = loadSss(sym);
  const gQuoted = (guid?.guides || []).find((g) => g.action !== "none" && g.quote);

  // Quant signals are RECOMPUTED here from the server's own sources (never taken from the URL —
  // a client-supplied string was spoofable and the poisoned preview would be CDN-cached).
  const sig = quant ? buildSig(quant, guid, sss) : "";
  const q0 = stats?.estimates?.find((e) => e.period === "0q") || stats?.estimates?.[0];
  const revDir = q0 && q0.epsCurrent != null && q0.eps90dAgo != null ? (q0.epsCurrent > q0.eps90dAgo ? "rising" : q0.epsCurrent < q0.eps90dAgo ? "falling" : "flat") : "n/a";
  const dist = stats?.ratings ? `${stats.ratings.strongBuy + stats.ratings.buy} buy / ${stats.ratings.hold} hold / ${stats.ratings.sell + stats.ratings.strongSell} sell` : "n/a";
  const ctx =
    `Ticker ${sym}. Upcoming-quarter consensus: EPS ${q0?.epsAvg ?? "?"} (range ${q0?.epsLow ?? "?"}–${q0?.epsHigh ?? "?"}, ${q0?.epsAnalysts ?? "?"} analysts), revenue ${q0?.revAvg ? "$" + (q0.revAvg / 1e9).toFixed(2) + "B" : "?"}, YoY growth ${q0?.growth != null ? (q0.growth * 100).toFixed(0) + "%" : "?"}. ` +
    `EPS estimates ${revDir} (revisions ${q0?.epsUp30d ?? 0} up / ${q0?.epsDown30d ?? 0} down, 30d). Sell-side: ${dist}, mean PT ${stats?.targetMean ?? "?"} vs price ${stats?.price ?? "?"}. ` +
    `Valuation fwd P/E ${stats?.forwardPE?.toFixed(0) ?? "?"}, op margin ${stats?.operatingMargins != null ? (stats.operatingMargins * 100).toFixed(0) + "%" : "?"}, short ${stats?.shortPercentOfFloat != null ? (stats.shortPercentOfFloat * 100).toFixed(1) + "% of float" : "?"}. ` +
    `Recent analyst moves: ${(stats?.ratingChanges || []).slice(0, 6).map((c) => `${c.firm} ${c.action} ${c.toGrade || ""}${c.targetTo ? " PT " + c.targetTo : ""}`).join("; ") || "none on file"}. ` +
    `Recent headlines: ${(news || []).slice(0, 8).map((n) => n.title.trim()).filter(Boolean).join(" | ") || "none"}.` +
    (gQuoted ? `\n\nSTANDING GUIDANCE, in the company's OWN WORDS (${gQuoted.period}, ${gQuoted.action}): "${String(gQuoted.quote).slice(0, 500)}"` : "") +
    (sig ? `\n\nQUANT SIGNALS — this terminal's own options + reaction-history analysis (GROUND the preview in the notable ones; synthesize, don't just restate): ${sig.slice(0, 1400)}` : "") +
    (priorRelease?.text ? `\n\nPRIOR EARNINGS PRESS RELEASE (8-K filed ${priorRelease.date} — the company's own results + outlook language from LAST quarter):\n${priorRelease.text.slice(0, 6000)}` : "") +
    (transcript?.text && transcript.text.length > 1000 ? `\n\nMOST RECENT EARNINGS CALL (${transcript.date || "prior quarter"} — ${transcript.title}):\n${transcript.text.slice(0, 9000)}` : "");
  return { sym, stats, quant, sig, consEps: q0?.epsAvg ?? null, consRevB: q0?.revAvg != null ? q0.revAvg / 1e9 : null, ctx };
}

export interface AiPreview {
  moneyLine: string;
  overview: string;
  thesis: string; // the OPERATIONAL story this quarter — qualitative, not the consensus numbers
  debate: string; // the genuine bull/bear tension THIS print resolves
  watch: string[];
  guidance: string;
  peerReads: string[];
  bull: string;
  bear: string;
  fromLastCall: string;
}

/** The StreetAccount-style narrative preview (PRO). `bounded` = live-route transport caps (the NAS has
 *  no platform ceiling); the nightly batch can afford the defaults. */
export async function buildAiPreview(c: PreviewContext, opts: { bounded?: boolean } = {}): Promise<AiPreview | null> {
  const SYSTEM =
    "Write a FactSet StreetAccount-style EARNINGS PREVIEW for the stock about to report — factual, concise, sell-side-desk voice, no hedging filler, no advice. Use BOTH the supplied data and your knowledge of the company. Fields: " +
    "'moneyLine' = ONE sentence: the single metric or guidance item that will decide the reaction. " +
    "'overview' = 1-2 sentences: the consensus the Street wants + how the stock is set up going in (positioning / bar high or low). " +
    "'thesis' = 2-3 sentences: the OPERATIONAL story this quarter — what the company will actually be reporting about (product cycles, segment inflections, pricing/demand, cost programs, one-time items), in business terms, NOT a restatement of the consensus numbers. Draw on the prior release/call language below where supplied. " +
    "'debate' = ONE sentence naming the genuine bull/bear disagreement THIS print resolves — the thing smart money actually argues about, not 'will they beat'. " +
    "'watch' = 3-5 SPECIFIC items the Street is focused on THIS quarter — actual KPIs/segments/guidance lines for THIS company, never 'will they beat EPS'. " +
    "'guidance' = the company's standing guidance + expectation (raise/reaffirm/cut/first guide), or note if none. " +
    "'peerReads' = 2-3 recent reads from sector peers / suppliers / customers that already reported or pre-announced, and the implied read-through for this name (use the headlines + your knowledge; if none, return []). " +
    "'bull' = the bull case into the print; 'bear' = the bear case / what's priced in. " +
    "If QUANT SIGNALS are supplied below, GROUND moneyLine/overview/bull/bear in the notable ones — e.g. options pricing a rich vs cheap move, a sell-the-news reaction pattern, post-earnings drift, a sandbagging guidance history, vol-crush — woven naturally into the narrative, NOT as a bullet dump. " +
    "'fromLastCall' = if a MOST RECENT EARNINGS CALL transcript is supplied below, 1-2 sentences on what management SAID or COMMITTED to last call (guidance given, targets, tone, promises) + the ONE thing to check for follow-through THIS print; if no transcript is supplied, return ''. " +
    "Use specific NUMBERS only from the supplied data; name segment/guidance items without fabricating precise figures. " +
    NO_ADVICE;
  // The explicit schema line is LOAD-BEARING: 10 narrative fields described in prose alone let the
  // model pick its own keys/nesting, which parses fine but fails our field validation → a silent null
  // (observed on the thesis/debate upgrade). Belt and braces with chatJSON's json_object mode.
  const SCHEMA = '\n\nReturn ONLY JSON with EXACTLY these keys: {"moneyLine": string, "overview": string, "thesis": string, "debate": string, "watch": string[], "guidance": string, "peerReads": string[], "bull": string, "bear": string, "fromLastCall": string}';
  // Live request → cap Gemini's reasoning + the transport (retries 2, 35s/attempt); the route adds a
  // 40s outer wall-clock race on top. Nightly leaves transport at the generous defaults. maxTokens 6000:
  // ten fields + reasoning overhead on a ~17k-char context — 4000 risked reasoning eating the output.
  const t = opts.bounded ? { retries: 2, timeoutMs: 35_000 } : {};
  const out = await chatJSON<any>(SYSTEM, c.ctx + SCHEMA, { maxTokens: 6000, model: PRO_MODEL, reasoningEffort: "low", ...t });
  const arr = (a: unknown) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && (x as string).trim()).map((x) => (x as string).trim()).slice(0, 6) : []);
  const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
  return out && (s(out.overview) || s(out.moneyLine) || arr(out.watch).length)
    ? { moneyLine: s(out.moneyLine), overview: s(out.overview), thesis: s(out.thesis), debate: s(out.debate), watch: arr(out.watch), guidance: s(out.guidance), peerReads: arr(out.peerReads), bull: s(out.bull), bear: s(out.bear), fromLastCall: s(out.fromLastCall) }
    : null;
}

export interface PredictedPrint {
  predEps: number | null; // the desk's predicted quarterly EPS
  predRevB: number | null; // predicted revenue, $B
  vsConsensus: "beat" | "miss" | "inline"; // the call vs the supplied consensus EPS
  reactionDir: "up" | "down"; // predicted 1-day reaction direction
  confidence: "high" | "medium" | "low";
  calls: { claim: string; rationale: string }[]; // 2-4 specific, checkable qualitative calls
}

/** The desk's OWN forecast of the print (FLASH — this runs nightly across ~dozens of reporters).
 *  A CONTROLLED inversion of the anti-fabrication rule: here the model is explicitly asked to
 *  estimate, the output is labelled a forecast, logged pre-print, and graded by code afterward. */
export async function predictPrint(c: PreviewContext): Promise<PredictedPrint | null> {
  const SYSTEM =
    "You are an earnings desk's FORECASTER. Using the supplied data AND your knowledge of the company, commit to YOUR OWN predicted print for the upcoming quarter. This output is explicitly a FORECAST — it will be recorded before the report and graded against the actuals, so commit to specific numbers rather than hedging. Fields: " +
    "'predEps' = your predicted quarterly EPS (number; the consensus is supplied — deviate from it only where you have a reason, and encode the reason in a call). " +
    "'predRevB' = your predicted revenue in $ BILLIONS (number, e.g. 12.34), or null if revenue consensus wasn't supplied. " +
    "'vsConsensus' = 'beat' | 'miss' | 'inline' — your EPS call vs the supplied consensus. " +
    "'reactionDir' = 'up' | 'down' — your predicted 1-day price reaction (weigh the setup/positioning signals: a beat can still sell off when the bar is high). " +
    "'confidence' = 'high' | 'medium' | 'low'. " +
    "'calls' = 2-4 SPECIFIC, CHECKABLE qualitative predictions with a one-line rationale each — e.g. {claim: 'guides FY revenue above Street', rationale: '...'}, {claim: 'datacenter segment accelerates sequentially', rationale: '...'}. Claims must be verifiable from the report/reaction, never vague. " +
    NO_ADVICE;
  const SCHEMA = '\n\nReturn ONLY JSON: {"predEps": number|null, "predRevB": number|null, "vsConsensus": "beat"|"miss"|"inline", "reactionDir": "up"|"down", "confidence": "high"|"medium"|"low", "calls": [{"claim": string, "rationale": string}]}';
  const out = await chatJSON<any>(SYSTEM, c.ctx + SCHEMA, { maxTokens: 1600, model: FLASH_MODEL, reasoningEffort: "low", retries: 2, timeoutMs: 45_000 });
  if (!out) return null;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const vs = ["beat", "miss", "inline"].includes(out.vsConsensus) ? (out.vsConsensus as PredictedPrint["vsConsensus"]) : null;
  const dir = ["up", "down"].includes(out.reactionDir) ? (out.reactionDir as PredictedPrint["reactionDir"]) : null;
  if (!vs || !dir) return null; // the two graded calls are mandatory — without them there's nothing to score
  const calls = (Array.isArray(out.calls) ? out.calls : [])
    .filter((x: any) => x && typeof x.claim === "string" && x.claim.trim())
    .map((x: any) => ({ claim: String(x.claim).trim().slice(0, 160), rationale: String(x.rationale || "").trim().slice(0, 240) }))
    .slice(0, 4);
  return {
    predEps: num(out.predEps),
    predRevB: num(out.predRevB),
    vsConsensus: vs,
    reactionDir: dir,
    confidence: ["high", "medium", "low"].includes(out.confidence) ? out.confidence : "medium",
    calls,
  };
}
