import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { getRatesCached } from "@/lib/macroData";
import FixedIncomeView from "@/components/FixedIncomeView";

export const revalidate = 1800;

export default async function RatesPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  // Only the curve + credit spreads are rendered here — getRatesCached serves the snapshot when present and
  // otherwise fetches just those series (not the full 32-series macro pull), so a cold load isn't a long hang.
  const macro = await getRatesCached();
  return <FixedIncomeView universe={universe} curve={macro.curve} asOf={macro.asOf} creditSeries={macro.creditSeries} />;
}
