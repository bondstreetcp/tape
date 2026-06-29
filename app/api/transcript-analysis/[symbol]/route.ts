import { NextRequest, NextResponse } from "next/server";
import { getRecentTranscripts } from "@/lib/transcripts";
import { chatJSON, NO_ADVICE, PRO_MODEL, llmConfigured } from "@/lib/llm";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// Sentieo/AlphaSense-style structured call analysis: the analyst-Q&A breakdown (how directly
// management answered) + what changed vs the prior quarter. Button-triggered; one Gemini pass over
// the latest transcript (+ a slice of the prior for the diff).
export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const name = req.nextUrl.searchParams.get("name") || sym;
  if (!(await llmConfigured())) return NextResponse.json({ configured: false });
  try {
    const calls = await getRecentTranscripts(sym, name, 2);
    const latest = calls?.[0];
    if (!latest || !latest.text || latest.text.length < 800) return NextResponse.json({ configured: true, available: false });
    const prior = calls?.[1];

    const SYSTEM =
      "You dissect earnings calls the way a Sentieo/AlphaSense analyst would. From the transcript, return: " +
      "'tone' — one line: confident or cautious, and on WHAT; " +
      "'topics' — 4-6 themes management emphasized this call; " +
      "'guidance' — the guidance language and whether it firmed up, held, or softened; " +
      "'exchanges' — the 3-6 most important analyst Q&A exchanges, each with: the topic, the analyst/firm if named (else ''), the GIST of the question, the GIST of management's answer, and 'directness' = how squarely they answered it (\"direct\" | \"partial\" | \"evasive\"); " +
      "'whatChanged' — 3-5 bullets comparing to the PRIOR quarter's call: new themes raised, themes dropped, tone shift, or a change in guidance language (if no prior call is supplied, return []). " +
      "Be specific and ground everything in the transcripts; quote sparingly. " +
      NO_ADVICE;
    const SCHEMA = 'Return ONLY JSON: {"tone": string, "topics": string[], "guidance": string, "exchanges": [{"topic": string, "analyst": string, "question": string, "answer": string, "directness": "direct"|"partial"|"evasive"}], "whatChanged": string[]}';
    const user =
      `${SCHEMA}\n\n=== LATEST CALL: ${latest.title} (${latest.date || "recent"}) ===\n${latest.text.slice(0, 22000)}` +
      (prior?.text ? `\n\n=== PRIOR CALL (for the what-changed diff): ${prior.title} (${prior.date || ""}) ===\n${prior.text.slice(0, 7000)}` : "");

    const out = await chatJSON<any>(SYSTEM, user, { maxTokens: 4500, model: PRO_MODEL, reasoningEffort: "low" });
    if (!out || (!out.tone && !(Array.isArray(out.exchanges) && out.exchanges.length))) return NextResponse.json({ configured: true, available: false });

    const s = (v: unknown) => (typeof v === "string" ? v.trim() : "");
    const arr = (a: unknown) => (Array.isArray(a) ? a.filter((x) => typeof x === "string" && (x as string).trim()).map((x) => (x as string).trim()).slice(0, 8) : []);
    const dir = (v: unknown) => (v === "direct" || v === "partial" || v === "evasive" ? v : "partial");
    const exchanges = (Array.isArray(out.exchanges) ? out.exchanges : [])
      .filter((e: any) => e && (s(e.question) || s(e.topic)))
      .map((e: any) => ({ topic: s(e.topic), analyst: s(e.analyst), question: s(e.question), answer: s(e.answer), directness: dir(e.directness) }))
      .slice(0, 7);

    return NextResponse.json(
      {
        configured: true,
        available: true,
        title: latest.title,
        date: latest.date,
        url: latest.url,
        source: latest.source,
        priorDate: prior?.date ?? null,
        tone: s(out.tone),
        topics: arr(out.topics),
        guidance: s(out.guidance),
        exchanges,
        whatChanged: arr(out.whatChanged),
      },
      { headers: { "Cache-Control": "public, s-maxage=21600, stale-while-revalidate=86400" } },
    );
  } catch (e: any) {
    return NextResponse.json({ configured: true, available: false, error: String(e?.message || e).slice(0, 200) });
  }
}
