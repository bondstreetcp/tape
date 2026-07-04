import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import type { VolDisData } from "@/lib/volDislocation";
import TermStructureView from "@/components/TermStructureView";

export const dynamic = "force-dynamic";

function loadVolDis(): Promise<VolDisData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "vol-dislocation.json"), "utf8")
    .then((s) => JSON.parse(s) as VolDisData)
    .catch(() => null);
}

export default async function TermStructurePage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Term Structure" relPath="/term-structure" />;
  const data = await loadVolDis();
  return <TermStructureView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), universe: "—", scanned: 0, rows: [] }} />;
}
