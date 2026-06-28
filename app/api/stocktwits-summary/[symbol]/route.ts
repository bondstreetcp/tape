import { NextResponse } from "next/server";
import { fetchStockTwitsWindow } from "@/lib/stocktwits";
import { chatJSON, NO_ADVICE, llmConfigured } from "@/lib/llm";

// Distilling messy retail chatter is a GLM job, NOT Gemini's: Gemini's safety filters choke on the
// crude/spammy posts and return empty. GLM is less restrictive and better at this extraction.
const toText = (v: unknown): string =>
  Array.isArray(v) ? v.filter((x) => typeof x === "string").join(" · ") : typeof v === "string" ? v : "";

export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Gemini distills a name's last day + week of StockTwits chatter into signal (most of it is noise).
// Lazy per-stock, cached 30 min. Returns { summary: null } when there's too little to summarize.
export async function GET(_req: Request, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  try {
    if (!(await llmConfigured())) return NextResponse.json({ summary: null });
    const msgs = await fetchStockTwitsWindow(symbol);
    if (!msgs || msgs.length < 8) return NextResponse.json({ summary: null }); // too thin to be worth it

    const now = Date.now();
    const day = msgs.filter((m) => now - Date.parse(m.createdAt) <= 86_400_000);
    const older = msgs.filter((m) => now - Date.parse(m.createdAt) > 86_400_000);
    const fmt = (arr: typeof msgs) => arr.slice(0, 70).map((m) => `[${m.sentiment || "·"}] ${m.body.replace(/\s+/g, " ").slice(0, 180)}`).join("\n");
    const sym = decodeURIComponent(symbol).toUpperCase();

    const SYSTEM =
      "You read retail StockTwits chatter and extract SIGNAL from the noise. Most posts ARE noise — pump spam, 'to the moon', generic hype, chart screenshots, one-word reactions. Look past them for what is ACTUALLY being discussed: a specific catalyst, news item, earnings/guidance, product or pipeline event, an analyst note, a short thesis, or concrete FUD. " +
      "Return two concise fields: 'day' = what's driving the chatter in the last 24h (1-2 sentences; name the concrete topic, or say it's just noise/quiet if so), and 'week' = the recurring themes and how sentiment has trended over the week (1-2 sentences). Be skeptical and specific — never output vague filler like 'mixed sentiment with some bulls and bears'. Ground it in the posts; don't invent news. " +
      NO_ADVICE;
    const SCHEMA = 'Return ONLY JSON: {"day": string, "week": string}';
    const user = `${SCHEMA}\n\nTicker $${sym}. StockTwits posts (newest first, prefixed by [sentiment]):\n\n=== LAST 24H (${day.length} posts) ===\n${fmt(day) || "(none)"}\n\n=== EARLIER THIS WEEK (${older.length} posts) ===\n${fmt(older) || "(none)"}`;

    const out = await chatJSON<{ day: unknown; week: unknown }>(SYSTEM, user, { maxTokens: 700 });
    const dayTxt = toText(out?.day).trim();
    const weekTxt = toText(out?.week).trim();
    if (!out || (!dayTxt && !weekTxt)) return NextResponse.json({ summary: null });

    return NextResponse.json(
      { summary: { day: dayTxt, week: weekTxt, dayCount: day.length, weekCount: msgs.length } },
      { headers: { "Cache-Control": "public, s-maxage=1800, stale-while-revalidate=3600" } },
    );
  } catch {
    return NextResponse.json({ summary: null });
  }
}
