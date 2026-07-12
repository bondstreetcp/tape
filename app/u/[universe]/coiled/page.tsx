import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import { fuseVolGamma } from "@/lib/volGamma";
import type { GammaBoardData } from "@/lib/gammaBoard";
import type { VolConeData } from "@/lib/volCone";
import CoiledSpringsView from "@/components/CoiledSpringsView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

const read = <T,>(file: string): Promise<T | null> =>
  fsp.readFile(path.join(process.cwd(), "data", file), "utf8").then((s) => JSON.parse(s) as T).catch(() => null);

export default async function CoiledSpringsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international)
    return <UsOnlyNotice universe={universe} label="Coiled Springs" relPath="/coiled" />;

  const [gamma, cone] = await Promise.all([read<GammaBoardData>("gamma-board.json"), read<VolConeData>("vol-cone.json")]);
  const rows = fuseVolGamma(gamma?.rows ?? [], cone?.rows ?? []);
  // freshest of the two inputs, so the "as of" reflects the join.
  const generatedAt = [gamma?.generatedAt, cone?.generatedAt].filter(Boolean).sort().slice(-1)[0] ?? null;
  return <CoiledSpringsView universe={universe} rows={rows} generatedAt={generatedAt} />;
}
