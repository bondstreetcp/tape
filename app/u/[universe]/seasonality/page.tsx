import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { SeasonData } from "@/lib/seasonality";
import SeasonalityView from "@/components/SeasonalityView";

export const dynamic = "force-dynamic";

function loadSeason(): Promise<SeasonData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "seasonality.json"), "utf8")
    .then((s) => JSON.parse(s) as SeasonData)
    .catch(() => null);
}

export default async function SeasonalityPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await loadSeason();
  return <SeasonalityView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), scanned: 0, rows: [] }} />;
}
