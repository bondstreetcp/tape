import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import BiotechVolView from "@/components/BiotechVolView";
import type { BiotechVolData } from "@/lib/biotechVol";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function load(): Promise<BiotechVolData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "biotech-vol.json"), "utf8")
    .then((s) => JSON.parse(s) as BiotechVolData)
    .catch(() => null);
}

export default async function BiotechVolPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Biotech Event Vol" relPath="/biotech-vol" />;
  const data = await load();
  return <BiotechVolView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), scanned: 0, rows: [] }} />;
}
