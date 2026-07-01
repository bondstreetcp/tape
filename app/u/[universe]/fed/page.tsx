import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { FedWatchData } from "@/lib/fedWatch";
import FedWatchView from "@/components/FedWatchView";

export const dynamic = "force-dynamic";

function loadFed(): Promise<FedWatchData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "fed-watch.json"), "utf8")
    .then((s) => JSON.parse(s) as FedWatchData)
    .catch(() => null);
}

export default async function FedPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await loadFed();
  return <FedWatchView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), items: [] }} />;
}
