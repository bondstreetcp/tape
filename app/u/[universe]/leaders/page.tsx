import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildLeaders } from "@/lib/leaders";
import LeadersView from "@/components/LeadersView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Leaders Board — computed at request from the current universe's snapshot (multi-timeframe returns
// + MA fields on every StockRow). No new feed.
export default async function LeadersPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const snap = await loadSnapshot(universe);
  const rows = snap?.stocks ? buildLeaders(snap.stocks) : [];
  if (!rows.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Leaders Board</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">No data for this universe yet (the board needs per-stock returns).</p>
      </main>
    );
  }
  return <LeadersView rows={rows} universe={universe} />;
}
