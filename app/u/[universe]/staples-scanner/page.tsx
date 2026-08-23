import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { StaplesScannerData } from "@/lib/staplesScanner";
import StaplesScannerView from "@/components/StaplesScannerView";

export const revalidate = 600; // ISR: extracted biweekly; the board is absolute figures (no baked "now"), so edge-cache is fine
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

const load = (): Promise<StaplesScannerData | null> =>
  fsp
    .readFile(path.join(process.cwd(), "data", "staples-scanner.json"), "utf8")
    .then((s) => JSON.parse(s) as StaplesScannerData)
    .catch(() => null);

export default async function StaplesScannerPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await load();
  return <StaplesScannerView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), reports: [] }} />;
}
