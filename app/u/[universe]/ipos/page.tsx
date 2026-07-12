import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { IpoData } from "@/lib/ipoMonitor";
import IpoMonitorView from "@/components/IpoMonitorView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function loadIpo(): Promise<IpoData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "ipo-monitor.json"), "utf8")
    .then((s) => JSON.parse(s) as IpoData)
    .catch(() => null);
}

export default async function IpoPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await loadIpo();
  return <IpoMonitorView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), scanned: 0, events: [] }} />;
}
