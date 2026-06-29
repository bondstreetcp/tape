import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildBreadth, buildRegime } from "@/lib/breadth";
import { getMacroCached } from "@/lib/macroData";
import BreadthView from "@/components/BreadthView";

export const dynamic = "force-dynamic";

// Breadth & Regime — market internals computed at request from the snapshot (MA/return fields on
// every StockRow) + the macro snapshot for the risk-backdrop strip. No new feed.
export default async function BreadthPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const snap = await loadSnapshot(universe);
  if (!snap?.stocks?.length) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center">
        <h1 className="text-2xl font-bold">Breadth &amp; Regime</h1>
        <p className="mt-3 text-sm text-[var(--text-3)]">No data for this universe yet.</p>
      </main>
    );
  }
  const data = buildBreadth(snap.stocks);
  let regime: ReturnType<typeof buildRegime> = [];
  try {
    regime = buildRegime(await getMacroCached());
  } catch {
    /* regime strip is optional */
  }
  return <BreadthView data={data} regime={regime} universe={universe} />;
}
