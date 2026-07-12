import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import type { PairsData } from "@/lib/pairs";
import PairsView from "@/components/PairsView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

const load = (): Promise<PairsData | null> =>
  fsp
    .readFile(path.join(process.cwd(), "data", "pairs.json"), "utf8")
    .then((s) => JSON.parse(s) as PairsData)
    .catch(() => null);

export default async function PairsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international)
    return <UsOnlyNotice universe={universe} label="Pairs — relative value" relPath="/pairs" />;
  const data = await load();
  return <PairsView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), universe: "S&P 500", scanned: 0, pairs: [] }} />;
}
