import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import type { CatalystVolData } from "@/lib/catalystVol";
import CatalystVolView from "@/components/CatalystVolView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function loadCatalystVol(): Promise<CatalystVolData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "catalyst-vol.json"), "utf8")
    .then((s) => JSON.parse(s) as CatalystVolData)
    .catch(() => null);
}

export default async function CatalystVolPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Catalyst Vol" relPath="/catalyst-vol" />;
  const data = await loadCatalystVol();
  return <CatalystVolView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), scanned: 0, rows: [] }} />;
}
