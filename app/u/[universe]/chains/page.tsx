import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { ValueChainsFile } from "@/lib/valueChains";
import ValueChainsView from "@/components/ValueChainsView";
import EmptyState from "@/components/EmptyState";

export const revalidate = 600;
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

export default async function Page({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await fs
    .readFile(path.join(process.cwd(), "data", "value-chains.json"), "utf8")
    .then((s) => JSON.parse(s) as ValueChainsFile)
    .catch(() => null);
  if (!data || !data.chains?.length) {
    return <EmptyState universe={universe} title="Value Chains" note="Builds on the nightly refresh once refresh-value-chains has run." />;
  }
  return <ValueChainsView universe={universe} data={data} />;
}
