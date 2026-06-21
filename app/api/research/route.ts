import { NextRequest, NextResponse } from "next/server";
import { listDocs, corpusIndex, storeAvailable } from "@/lib/research/store";
import { consensus } from "@/lib/research/synthesize";

export const dynamic = "force-dynamic";

// GET /api/research            → { index } (tickers in the corpus)
// GET /api/research?ticker=MU  → { docs, consensus } for a ticker (fast; no LLM)
export async function GET(req: NextRequest) {
  if (!storeAvailable()) return NextResponse.json({ available: false, index: [], docs: [] });
  const ticker = req.nextUrl.searchParams.get("ticker")?.toUpperCase() || null;
  if (!ticker) return NextResponse.json({ available: true, index: corpusIndex() });
  const docs = listDocs(ticker);
  // strip the full report text from the list payload — it's large and licensed; the
  // server keeps it for grounded search.
  const lite = docs.map(({ text, ...rest }) => rest);
  return NextResponse.json({ available: true, ticker, docs: lite, consensus: consensus(docs) });
}
