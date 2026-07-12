import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { VolDisData } from "@/lib/volDislocation";
import SkewView from "@/components/SkewView";
import UsOnlyNotice from "@/components/UsOnlyNotice";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function loadVolDis(): Promise<VolDisData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "vol-dislocation.json"), "utf8")
    .then((s) => JSON.parse(s) as VolDisData)
    .catch(() => null);
}

export default async function SkewPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Skew Screener" relPath="/skew" />;
  const data = await loadVolDis();
  return <SkewView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), universe: "—", scanned: 0, rows: [] }} />;
}
