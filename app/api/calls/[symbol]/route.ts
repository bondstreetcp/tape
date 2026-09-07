import { NextRequest, NextResponse } from "next/server";
import { loadSymbolCalls } from "@/lib/callsArchive";

// Our OWN earnings-call archive (data/calls, hydrated from R2) — the quarters we hold for a ticker, newest first,
// with the AI digest's one-line tl;dr when it's been ingested. Powers the "Earnings-call transcripts" section on
// the stock page's Filings & Calls tab (each quarter links into the /transcripts reader). Replaces the old
// external-publisher link list. Server-only fs read; safe/empty when nothing is archived yet.
export const dynamic = "force-dynamic";
export const maxDuration = 15;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ symbol: string }> }) {
  const { symbol } = await params;
  const sym = decodeURIComponent(symbol).toUpperCase();
  try {
    const calls = await loadSymbolCalls(sym); // newest-first
    const quarters = calls.map((c) => ({
      period: c.fiscalPeriod,
      callDate: c.callDate,
      title: c.title,
      source: c.source,
      hasDigest: !!c.digest,
      tone: c.digest?.tone ?? null,
      tldr: c.digest?.tldr ?? null,
      chars: c.transcript?.chars ?? 0,
    }));
    return NextResponse.json(
      { quarters },
      { headers: { "Cache-Control": "public, s-maxage=600, stale-while-revalidate=86400" } },
    );
  } catch (e) {
    return NextResponse.json({ quarters: [], error: String((e as Error)?.message || e) });
  }
}
