import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { loadCatalysts } from "@/lib/catalysts";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import HomeDashboard from "@/components/HomeDashboard";
import SetupNotice from "@/components/SetupNotice";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

export default async function UniverseHome({
  params,
}: {
  params: Promise<{ universe: string }>;
}) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const [snapshot, catalysts] = await Promise.all([loadSnapshot(universe), loadCatalysts()]);
  if (!snapshot || snapshot.stocks.length === 0) return <SetupNotice />;
  return <HomeDashboard snapshot={snapshot} universe={universe} catalysts={catalysts} />;
}
