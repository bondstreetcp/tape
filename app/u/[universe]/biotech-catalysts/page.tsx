import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { BiotechData } from "@/lib/biotech";
import BiotechView from "@/components/BiotechView";

export const dynamic = "force-dynamic";

function loadBiotech(): Promise<BiotechData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "biotech-catalysts.json"), "utf8")
    .then((s) => JSON.parse(s) as BiotechData)
    .catch(() => null);
}

export default async function BiotechPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await loadBiotech();
  return <BiotechView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), scanned: 0, items: [] }} />;
}
