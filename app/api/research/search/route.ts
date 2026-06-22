import { NextRequest, NextResponse } from "next/server";
import { semanticSearchAvailable } from "@/lib/research/store";
import { corpusSearch } from "@/lib/research/synthesize";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// POST { query, ticker? } → semantic search across the corpus → { answer, hits }.
export async function POST(req: NextRequest) {
  if (!semanticSearchAvailable()) return NextResponse.json({ available: false, hits: [], answer: null });
  const body = await req.json().catch(() => ({}));
  const query = String(body.query || "").trim();
  if (!query) return NextResponse.json({ error: "query required" }, { status: 400 });
  try {
    const r = await corpusSearch(query, body.ticker ? String(body.ticker) : undefined);
    return NextResponse.json({ available: true, ...r });
  } catch (e: any) {
    return NextResponse.json({ error: String(e?.message || e).slice(0, 160) });
  }
}
