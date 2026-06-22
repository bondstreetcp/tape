import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { loadSuperInvestors } from "@/lib/superinvestors";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import SuperInvestorsView from "@/components/SuperInvestorsView";

export const dynamic = "force-dynamic";

// Curated value-manager 13F holdings. Universe-independent data (U.S. equities), but we pass
// the current universe's symbol set so a ticker only links when it lives in this universe.
export default async function SuperInvestorsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const [data, snapshot] = await Promise.all([loadSuperInvestors(), loadSnapshot(universe)]);
  if (!data || !data.investors.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Super-Investors</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">Holdings data isn&apos;t built yet. Run <code className="rounded bg-[var(--surface)] px-1.5 py-0.5">npm run refresh-13f</code> to fetch the latest 13F filings.</p>
      </main>
    );
  }
  const known = snapshot?.stocks.map((s) => s.symbol) ?? [];
  return <SuperInvestorsView universe={universe} data={data} known={known} />;
}
