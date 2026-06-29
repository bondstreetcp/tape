import { NextRequest, NextResponse } from "next/server";
import { summarizeText } from "@/lib/ask";
import { llmConfigured } from "@/lib/llm";
import { getLatestTranscript } from "@/lib/transcripts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INSTRUCTION =
  `Summarize this earnings call as clean, SCANNABLE markdown — use "## " section headers and bullet points, never dense paragraphs. Sections, in this order:\n` +
  `## Headline\n- One sentence: the takeaway.\n` +
  `## Results & guidance\n- 3-5 bullets: the key reported numbers and any forward guidance, with specifics.\n` +
  `## Management tone\n- 1-2 bullets: confident or cautious, and on what.\n` +
  `## Notable quotes\n- 2-3 bullets: a short verbatim line in quotation marks, with who said it.\n` +
  `## Q&A highlights\n` +
  `- Format EVERY analyst exchange as its OWN one-line bullet, exactly like: "- **Topic (Analyst / Firm)** — what they pressed on → how management answered."\n` +
  `- Cover the 4-6 most important exchanges. Never write a paragraph here.\n` +
  `Be concrete and balanced; ground everything in the transcript.`;

export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const name = req.nextUrl.searchParams.get("name") || sym;
  if (!(await llmConfigured())) return NextResponse.json({ configured: false });
  try {
    const t = await getLatestTranscript(sym, name);
    if (!t || !t.text || t.text.length < 500) {
      return NextResponse.json({ configured: true, available: false });
    }
    const result = await summarizeText(t.title || `${name} earnings call`, INSTRUCTION, t.text);
    return NextResponse.json({
      configured: true,
      available: true,
      title: t.title,
      date: t.date,
      url: t.url,
      source: t.source,
      summary: result?.answer ?? null,
    });
  } catch (e: any) {
    return NextResponse.json({ configured: true, available: false, error: String(e?.message || e).slice(0, 200) });
  }
}
