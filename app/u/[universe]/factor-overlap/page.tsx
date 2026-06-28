import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildFactorOverlap } from "@/lib/factorOverlap";
import FactorOverlapView from "@/components/FactorOverlapView";

export const dynamic = "force-dynamic";

// Factor-Screen Overlap — computed at request from the current universe's snapshot (its per-stock
// `fund` metrics drive the 9 named screens).
export default async function FactorOverlapPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const snap = await loadSnapshot(universe);
  const names = snap?.stocks ? buildFactorOverlap(snap.stocks) : [];
  if (!names.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Factor-Screen Overlap</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">No overlap found for this universe (the screens need per-stock fundamentals). Try the S&amp;P 500 or a broad universe.</p>
      </main>
    );
  }
  return <FactorOverlapView universe={universe} names={names} />;
}
