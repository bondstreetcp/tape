import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { CorpEventsData } from "@/lib/corpEvents";
import CorpEventsView from "@/components/CorpEventsView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function loadCorpEvents(): Promise<CorpEventsData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "corp-events.json"), "utf8")
    .then((s) => JSON.parse(s) as CorpEventsData)
    .catch(() => null);
}

export default async function CorpEventsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await loadCorpEvents();
  return <CorpEventsView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), scanned: 0, events: [] }} />;
}
