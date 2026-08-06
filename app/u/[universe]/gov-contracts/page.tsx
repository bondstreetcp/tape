import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import GovContractsView from "@/components/GovContractsView";
import EmptyState from "@/components/EmptyState";
import type { GovContractsFile } from "@/lib/govContracts";

export const revalidate = 600;
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Government contract-award momentum (USAspending). Global roster, not universe-filtered; the
// [universe] param only drives the header + stock links.
export default async function GovContractsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await fs
    .readFile(path.join(process.cwd(), "data", "gov-contracts.json"), "utf8")
    .then((s) => JSON.parse(s) as GovContractsFile)
    .catch(() => null);
  if (!data || !data.rows.length) return <EmptyState universe={universe} title="Government Contracts" note="Builds on the nightly refresh once the USAspending scan has run." />;
  return <GovContractsView universe={universe} data={data} />;
}
