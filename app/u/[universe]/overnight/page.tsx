import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { loadOvernightFilings } from "@/lib/overnightFilings";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import OvernightFilingsView from "@/components/OvernightFilingsView";

export const dynamic = "force-dynamic";

// Overnight Filings (SuperAnalyst) — AI desk notes on new material SEC filings vs the prior
// comparable. Universe-independent data; the current universe's symbol set is passed so a ticker
// only links when it lives in this universe.
export default async function OvernightPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const [data, snapshot] = await Promise.all([loadOvernightFilings(), loadSnapshot(universe)]);
  if (!data) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Overnight Filings</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">Digests aren&apos;t built yet. Run <code className="rounded bg-[var(--surface)] px-1.5 py-0.5">npm run refresh-overnight-filings</code> to summarize the latest material SEC filings.</p>
      </main>
    );
  }
  const known = snapshot?.stocks.map((s) => s.symbol) ?? [];
  return <OvernightFilingsView universe={universe} data={data} known={known} />;
}
