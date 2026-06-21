import { NextRequest, NextResponse } from "next/server";
import { listDocs } from "@/lib/research/store";
import { synthesize, searchCorpus } from "@/lib/research/synthesize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { ticker }              → { synthesis }   (cross-broker synthesis)
// POST { ticker, question }    → { answer }       (Q&A over the corpus)
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const ticker = String(body.ticker || "").toUpperCase();
  if (!ticker) return NextResponse.json({ error: "ticker required" }, { status: 400 });
  const docs = listDocs(ticker);
  if (!docs.length) return NextResponse.json({ error: "no documents for this ticker" });
  try {
    const out = body.question ? await searchCorpus(docs, String(body.question)) : await synthesize(docs);
    return NextResponse.json(body.question ? { answer: out } : { synthesis: out });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) });
  }
}
