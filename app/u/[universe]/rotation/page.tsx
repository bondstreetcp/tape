import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import SectorRotation from "@/components/SectorRotation";

export const dynamic = "force-dynamic";

export default async function RotationPage({
  params,
}: {
  params: Promise<{ universe: string }>;
}) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  return <SectorRotation universe={universe} />;
}
