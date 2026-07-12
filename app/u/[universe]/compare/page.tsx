import { notFound } from "next/navigation";
import { loadSnapshot, loadManySymbolSeries } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import SectorCompareView from "@/components/SectorCompareView";
import SetupNotice from "@/components/SetupNotice";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

export default async function SectorComparePage({
  params,
}: {
  params: Promise<{ universe: string }>;
}) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const snapshot = await loadSnapshot(universe);
  if (!snapshot || snapshot.stocks.length === 0) return <SetupNotice />;

  // sectors present in this universe, ordered by total constituent market cap
  const present = [...snapshot.sectors].sort((a, b) => b.marketCap - a.marketCap);
  const seriesMap = await loadManySymbolSeries(present.map((s) => s.etf));

  const sectors = present
    .filter((s) => seriesMap[s.etf])
    .map((s) => ({
      etf: s.etf,
      name: s.name,
      count: s.count,
      daily: seriesMap[s.etf].daily,
      intraday: seriesMap[s.etf].intraday,
    }));

  return (
    <SectorCompareView
      universe={universe}
      sectors={sectors}
      generatedAt={snapshot.generatedAt}
    />
  );
}
