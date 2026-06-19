import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import MarketHeatmapView from "@/components/MarketHeatmapView";

export const dynamic = "force-dynamic";

export default async function HeatmapPage({
  params,
}: {
  params: Promise<{ universe: string }>;
}) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const snapshot = await loadSnapshot(universe);
  if (!snapshot) notFound();
  return (
    <MarketHeatmapView universe={universe} stocks={snapshot.stocks} generatedAt={snapshot.generatedAt} />
  );
}
