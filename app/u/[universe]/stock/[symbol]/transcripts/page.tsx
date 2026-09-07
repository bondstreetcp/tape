import { loadSnapshot } from "@/lib/data";
import { loadSymbolCalls } from "@/lib/callsArchive";
import { parseTranscriptTurns } from "@/lib/transcriptTurns";
import TranscriptReader, { type TranscriptReaderData } from "@/components/TranscriptReader";

/** Human reading view for a ticker's archived earnings-call transcripts (data/calls) — an iMessage-style
 *  thread with a quarter picker + the AI digest. Server component: reads the archive (fs, hydrated from R2),
 *  ships only the selected quarter's turns; the picker is ?q=<period> links. */
export default async function TranscriptsPage({
  params,
  searchParams,
}: {
  params: Promise<{ universe: string; symbol: string }>;
  searchParams: Promise<{ q?: string }>;
}) {
  const { universe, symbol } = await params;
  const { q } = await searchParams;
  const sym = decodeURIComponent(symbol).toUpperCase();

  const [snap, calls] = await Promise.all([loadSnapshot(universe).catch(() => null), loadSymbolCalls(sym)]);
  const name = snap?.stocks?.find((s) => s.symbol === sym)?.name || sym;

  const base = `/u/${universe}/stock/${encodeURIComponent(sym)}/transcripts`;
  const selectedRec = (q && calls.find((c) => c.fiscalPeriod === q)) || calls[0] || null; // calls are newest-first
  const quarters = calls.map((c) => ({
    period: c.fiscalPeriod,
    callDate: c.callDate,
    href: `${base}?q=${encodeURIComponent(c.fiscalPeriod)}`,
    active: !!selectedRec && c.fiscalPeriod === selectedRec.fiscalPeriod,
  }));
  const selected: TranscriptReaderData | null = selectedRec
    ? {
        period: selectedRec.fiscalPeriod,
        callDate: selectedRec.callDate,
        title: selectedRec.title,
        source: selectedRec.source,
        url: selectedRec.url,
        digest: selectedRec.digest,
        turns: parseTranscriptTurns(selectedRec.transcript.text),
      }
    : null;

  return <TranscriptReader symbol={sym} name={name} quarters={quarters} selected={selected} />;
}
