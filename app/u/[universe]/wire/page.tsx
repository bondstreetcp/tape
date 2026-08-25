import { notFound } from "next/navigation";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { getMarketHeadlines } from "@/lib/marketHeadlinesFetch";
import MarketHeadlinesWire from "@/components/MarketHeadlinesWire";

// The full-page market wire — Walter Bloomberg's curated flashes + the reputable aggregate, live. The
// baked file just seeds SSR; MarketHeadlinesWire refreshes from /api/market-headlines (~2-min) on mount.
export const dynamic = "force-dynamic";

export default async function WirePage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const headlines = await getMarketHeadlines(60).catch(() => []);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <div className="mb-3">
        <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
        <h1 className="mt-1 text-2xl font-bold">Market Wire</h1>
        <p className="mt-1 max-w-2xl text-[13px] text-[var(--text-3)]">
          <span className="text-[var(--accent)]">⚡</span> Walter Bloomberg&apos;s curated market flashes leading, then a reputable-source aggregate (Reuters, Bloomberg, CNBC, WSJ…). Macro, Fed, trade, energy &amp; geopolitics — the flashes the company news tape doesn&apos;t carry. Refreshes ~every 2 min; <span className="font-semibold text-[var(--accent)]">NEW</span> marks the last few minutes, and a $ticker chip opens the name. Research, not advice.
        </p>
      </div>
      <MarketHeadlinesWire initial={headlines} />
    </main>
  );
}
