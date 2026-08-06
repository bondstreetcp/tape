import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import ShortMechanicsView from "@/components/ShortMechanicsView";
import EmptyState from "@/components/EmptyState";
import type { ShortMechFile } from "@/lib/shortMechanics";

export const revalidate = 600;
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Short-selling mechanics (FINRA daily short volume + SEC fails-to-deliver) over the US universe.
export default async function ShortMechanicsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await fs
    .readFile(path.join(process.cwd(), "data", "short-mechanics.json"), "utf8")
    .then((s) => JSON.parse(s) as ShortMechFile)
    .catch(() => null);
  if (!data || !data.rows.length) return <EmptyState universe={universe} title="Short Mechanics" note="Builds on the nightly refresh once the FINRA / SEC files have been pulled." />;
  return <ShortMechanicsView universe={universe} data={data} />;
}
