import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import type { GammaBoardData } from "@/lib/gammaBoard";
import GammaBoardView from "@/components/GammaBoardView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

const load = (): Promise<GammaBoardData | null> =>
  fsp
    .readFile(path.join(process.cwd(), "data", "gamma-board.json"), "utf8")
    .then((s) => JSON.parse(s) as GammaBoardData)
    .catch(() => null);

export default async function GammaBoardPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international)
    return <UsOnlyNotice universe={universe} label="Dealer Gamma Board" relPath="/gamma-board" />;
  const data = await load();
  return <GammaBoardView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), universe: "sp500", scanned: 0, rows: [] }} />;
}
