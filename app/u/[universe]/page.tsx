import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import HomeDashboard from "@/components/HomeDashboard";
import SetupNotice from "@/components/SetupNotice";

export const dynamic = "force-dynamic";

export default async function UniverseHome({
  params,
}: {
  params: Promise<{ universe: string }>;
}) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const snapshot = await loadSnapshot(universe);
  if (!snapshot || snapshot.stocks.length === 0) return <SetupNotice />;
  return <HomeDashboard snapshot={snapshot} universe={universe} />;
}
