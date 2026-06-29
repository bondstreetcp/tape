import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildExpectations } from "@/lib/expectations";
import ExpectationsView from "@/components/ExpectationsView";

export const dynamic = "force-dynamic";

// Expectations / Reverse-DCF — computed at request from the snapshot's per-stock fund block
// (fcfYield + revenue growth). Pure compute, no new feed.
export default async function ExpectationsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const snap = await loadSnapshot(universe);
  const data = snap?.stocks ? buildExpectations(snap.stocks) : { rows: [], coverage: 0 };
  if (!data.rows.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Expectations (Reverse-DCF)</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">No data for this universe yet (needs per-stock free-cash-flow yield). Try the S&amp;P 500 or a broad universe.</p>
      </main>
    );
  }
  return <ExpectationsView data={data} universe={universe} />;
}
