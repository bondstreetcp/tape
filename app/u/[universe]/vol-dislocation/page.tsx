import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import type { VolDisData } from "@/lib/volDislocation";
import type { VpLedgerFile } from "@/lib/volPremiumLedger";
import { dealTags, type MergerArbFile } from "@/lib/mergerArb";
import VolDislocationView from "@/components/VolDislocationView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function loadVolDis(): Promise<VolDisData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "vol-dislocation.json"), "utf8")
    .then((s) => JSON.parse(s) as VolDisData)
    .catch(() => null);
}

function loadLedger(): Promise<VpLedgerFile | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "vol-premium-ledger.json"), "utf8")
    .then((s) => JSON.parse(s) as VpLedgerFile)
    .catch(() => null);
}

// Live merger targets (DEFM14A) — flag deal-pinned names whose vol is crushed by the deal, not cheap.
function loadDeals(): Promise<MergerArbFile | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "merger-arb.json"), "utf8")
    .then((s) => JSON.parse(s) as MergerArbFile)
    .catch(() => null);
}

export default async function VolDislocationPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Vol Dislocation" relPath="/vol-dislocation" />;
  const [data, ledger, deals] = await Promise.all([loadVolDis(), loadLedger(), loadDeals()]);
  return <VolDislocationView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), universe: "—", scanned: 0, rows: [] }} ledger={ledger} deals={dealTags(deals)} />;
}
