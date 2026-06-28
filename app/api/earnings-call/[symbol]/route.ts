import { NextRequest, NextResponse } from "next/server";
import { summarizeText } from "@/lib/ask";
import { llmConfigured } from "@/lib/llm";
import { getLatestTranscript } from "@/lib/transcripts";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

const INSTRUCTION =
  `Summarize this earnings call in tight markdown sections: ` +
  `**Headline** (the one-sentence takeaway), ` +
  `**Results & guidance** (the key reported numbers and any forward guidance, with specifics), ` +
  `**Management tone** (confident or cautious, and on what), ` +
  `**Notable quotes** (2-3 short verbatim lines in quotation marks), and ` +
  `**Q&A highlights** (what analysts pressed on and how management responded). Be concrete and balanced.`;

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
