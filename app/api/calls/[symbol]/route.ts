import { NextRequest, NextResponse } from "next/server";
import { loadSymbolCalls } from "@/lib/callsArchive";
import { parseTranscriptTurns } from "@/lib/transcriptTurns";

// Our OWN earnings-call archive (data/calls, hydrated from R2) for the INLINE reader on the stock page's
// Filings & Calls tab. Returns the quarter list (newest first, with the AI digest's tone + tl;dr when ingested)
// plus the SELECTED quarter's parsed iMessage turns (?q=<period>, else newest). Only one quarter's turns ship
// per request, so the payload stays bounded. Server-only fs read; safe/empty when nothing is archived yet.
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  const q = req.nextUrl.searchParams.get("q");
  try {
    const calls = await loadSymbolCalls(sym); // newest-first
    const quarters = calls.map((c) => ({
      period: c.fiscalPeriod,
      callDate: c.callDate,
      hasDigest: !!c.digest,
      tone: c.digest?.tone ?? null,
      tldr: c.digest?.tldr ?? null,
    }));
    const rec = (q && calls.find((c) => c.fiscalPeriod === q)) || calls[0] || null;
    const selected = rec
      ? {
          period: rec.fiscalPeriod,
          callDate: rec.callDate,
          title: rec.title,
          source: rec.source,
          url: rec.url,
          digest: rec.digest,
          turns: parseTranscriptTurns(rec.transcript.text),
        }
      : null;
    return NextResponse.json(
      { quarters, selected },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400" } },
    );
  } catch (e) {
    return NextResponse.json({ quarters: [], selected: null, error: String((e as Error)?.message || e) });
  }
}
