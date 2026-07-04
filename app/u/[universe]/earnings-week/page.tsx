import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import EarningsWeekView, { type EmData } from "@/components/EarningsWeekView";

export const dynamic = "force-dynamic";

function loadEm(): Promise<EmData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "earnings-move.json"), "utf8")
    .then((s) => JSON.parse(s) as EmData)
    .catch(() => null);
}

export default async function EarningsWeekPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await loadEm();
  return <EarningsWeekView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), windowDays: 16, rows: [] }} />;
}
