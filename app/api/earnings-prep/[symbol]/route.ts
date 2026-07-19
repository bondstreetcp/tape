import { NextResponse } from "next/server";
import { getEarningsReactions } from "@/lib/earningsReaction";
import { getNews } from "@/lib/news";
import { chatJSON, NO_ADVICE, PRO_MODEL, llmConfigured } from "@/lib/llm";
import { computeQuant, peerReadThrough, buildSig, loadGuidance, loadSss } from "@/lib/earningsQuant";
import { assemblePreviewContext, buildAiPreview, earningsReleaseText, raceTimeout } from "@/lib/earningsPreview";
import { computePreprint, narratePreprint, type PublicInputs } from "@/lib/research/preprint";
import { listDocs, normTicker } from "@/lib/research/store";
import { beatGuide } from "@/lib/guidance";
import { cachedStats } from "@/lib/companyCache";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Parts: ?part=data (fast, no LLM — reaction history, options skew/max-pain; auto-loaded),
// ?part=ai (the StreetAccount-style preview; button-triggered), ?part=why (explain one past print),
// ?part=preprint (the research-corpus × quant "Before the print" read; button-triggered).
// The quant engine + preview builders live in lib/earningsQuant.ts / lib/earningsPreview.ts, SHARED
// with the nightly preview logger so the logged record is exactly what this route serves.

export async function GET(req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const sp = new URL(req.url).searchParams;
  const part = sp.get("part") || "data";
  // Keep the FULL timestamp when provided — straddleMove uses the hour for the AMC bracketing rule
  // (after-close prints need an expiry strictly after the report date; date-only keeps on-or-after).
  const earningsISO = (() => { const e = sp.get("e"); return e && /^\d{4}-\d{2}-\d{2}/.test(e) ? e : null; })();

  try {
    // ── AI part: the StreetAccount-style preview (button-triggered) ──
    if (part === "ai") {
      if (!(await llmConfigured())) return NextResponse.json({ ai: null });
      // Every live sub-fetch inside assemblePreviewContext is time-bound, and the LLM call gets a 40s
      // outer wall-clock race — `export const maxDuration` is Vercel-only and a no-op under
      // `next start` on the NAS, so these bounds ARE the ceiling ("the AI's not working" fix).
      const c = await assemblePreviewContext(sym, earningsISO);
      const ai = await raceTimeout(buildAiPreview(c, { bounded: true }), 40_000, null);
      // Cache ONLY successes — a cached {ai:null} bricked the preview for every viewer for 3 hours.
      return NextResponse.json({ ai }, { headers: { "Cache-Control": ai ? "public, s-maxage=10800, stale-while-revalidate=21600" : "no-store" } });
    }

    // ── "Before the print": the ingested-research × quant read (button-triggered) ──
    if (part === "preprint") {
      const docs = await listDocs(normTicker(sym)).catch(() => []);
      // No ingested research → say so honestly. NEVER manufacture a research edge; the client renders
      // a "quant-only — ingest notes to light this up" state. no-store: the user may upload PDFs and
      // click again a minute later.
      if (!docs.length) return NextResponse.json({ preprint: null, hasResearch: false }, { headers: { "Cache-Control": "no-store" } });
      const [stats, quant] = await Promise.all([
        raceTimeout(cachedStats(sym).catch(() => null), 10_000, null),
        raceTimeout(computeQuant(sym, earningsISO).catch(() => null), 20_000, null),
      ]);
      const guid = loadGuidance(sym);
      const q0 = stats?.estimates?.find((e) => e.period === "0q") || stats?.estimates?.[0];
      const bg = beatGuide(guid?.history);
      const pub: PublicInputs = {
        recommendationMean: stats?.recommendationMean ?? null,
        targetMean: stats?.targetMean ?? null,
        price: stats?.price ?? quant?.straddle?.price ?? null,
        epsUp30d: q0?.epsUp30d ?? null,
        epsDown30d: q0?.epsDown30d ?? null,
        tradeLean: quant?.trade?.lean ?? null,
        sandbagger: bg ? bg.total >= 3 && bg.beats / bg.total >= 0.7 : null,
        richnessVerdict: (quant?.richness?.verdict as PublicInputs["richnessVerdict"]) ?? null,
        putsBid: quant?.options?.skew != null ? quant.options.skew > 0.02 : null,
      };
      const read = computePreprint(docs, pub);
      const sig = quant ? buildSig(quant, guid, loadSss(sym)) : "";
      const narration = (await llmConfigured()) ? await raceTimeout(narratePreprint(sym, read, docs, sig, { bounded: true }), 40_000, null) : null;
      return NextResponse.json(
        { preprint: { ...read, narration }, hasResearch: true },
        // Short cache: a fresh note upload should show up on the next click, not 3h later.
        { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } },
      );
    }

    // ── "Why" part: explain a SINGLE past print's reaction (clicked from the reactions table) ──
    // e.g. "beat EPS but fell 18% — why?". Grounded in the reaction facts + headlines dated near the
    // print; the LLM is hard-gated against fabricating specifics it can't support (esp. recent quarters).
    if (part === "why") {
      const dISO = (() => { const dd = sp.get("d"); return dd && /^\d{4}-\d{2}-\d{2}/.test(dd) ? dd.slice(0, 10) : null; })();
      if (!dISO || !(await llmConfigured())) return NextResponse.json({ why: null });
      // Same NAS-has-no-function-ceiling discipline as part=ai: every live fetch is time-bound.
      const [reactions, news, release] = await Promise.all([
        raceTimeout(getEarningsReactions(sym, 8).catch(() => []), 15_000, [] as Awaited<ReturnType<typeof getEarningsReactions>>),
        raceTimeout(getNews(sym, 30).catch(() => []), 12_000, [] as Awaited<ReturnType<typeof getNews>>),
        raceTimeout(earningsReleaseText(sym, dISO).catch(() => null), 15_000, null), // the actual 8-K press release (primary source)
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
      // Same transport caps + wall-clock ceiling as part=ai (maxDuration is a no-op on the NAS).
      const out = await raceTimeout(
        chatJSON<{ why?: string; confidence?: string }>(SYSTEM, ctx + "\n\n" + SCHEMA, { maxTokens: 1600, model: PRO_MODEL, reasoningEffort: "low", retries: 2, timeoutMs: 35_000 }),
        40_000,
        null,
      );
      const why = out && typeof out.why === "string" && out.why.trim() ? out.why.trim() : null;
      return NextResponse.json(
        {
          why,
          // enum-coerce — the badge renders this raw, and models occasionally embellish the value
          confidence: out?.confidence && ["high", "medium", "low"].includes(out.confidence) ? out.confidence : null,
          grounded: !!release?.text, // whether the recap is backed by the actual 8-K release
          filing: release ? { url: release.url, date: release.date } : null,
          headlines: near.map((n) => ({ title: n.title, publisher: n.publisher, link: n.link, time: n.time })),
          fact: rx ? { surprise: rx.surprise, move: rx.move, drift5: rx.drift5, timing: rx.timing } : null,
        },
        // Cache only successes — a cached {why:null} bricked the drill-down for 24h for everyone.
        { headers: { "Cache-Control": why ? "public, s-maxage=86400, stale-while-revalidate=172800" : "no-store" } },
      );
    }

    // ── Data part: reaction history + implied move + options skew/max-pain (fast, auto-loaded) ──
    const { closes, ...quant } = await computeQuant(sym, earningsISO);
    const peerSympathy = await peerReadThrough(sym, closes);

    return NextResponse.json(
      { data: { ...quant, peerSympathy } },
      { headers: { "Cache-Control": "public, s-maxage=10800, stale-while-revalidate=21600" } },
    );
  } catch {
    return NextResponse.json(part === "ai" ? { ai: null } : part === "preprint" ? { preprint: null, hasResearch: false } : { data: null });
  }
}
