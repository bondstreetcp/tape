import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import MergerArbView from "@/components/MergerArbView";
import EmptyState from "@/components/EmptyState";
import type { MergerArbFile } from "@/lib/mergerArb";

export const revalidate = 600;
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Merger-arb: live cash-deal spreads from EDGAR definitive merger proxies. Global, not universe-filtered.
export default async function MergerArbPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await fs
    .readFile(path.join(process.cwd(), "data", "merger-arb.json"), "utf8")
    .then((s) => JSON.parse(s) as MergerArbFile)
    .catch(() => null);
  if (!data) return <EmptyState universe={universe} title="Merger Arbitrage" note="Builds on the nightly refresh once the EDGAR merger-proxy scan has run." />;
  if (!data.rows.length)
    return <EmptyState universe={universe} title="Merger Arbitrage" note={`No live cash deals right now — the scan saw ${data.scanned} definitive proxies in the last few months, but they were stock-for-stock or SPAC combinations. Cash deals are episodic.`} />;
  return <MergerArbView universe={universe} data={data} />;
}
