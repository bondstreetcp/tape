import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import type { MergerArbData } from "@/lib/mergerArb";
import MergerArbView from "@/components/MergerArbView";

export const dynamic = "force-dynamic";

const load = (): Promise<MergerArbData | null> =>
  fsp
    .readFile(path.join(process.cwd(), "data", "merger-arb.json"), "utf8")
    .then((s) => JSON.parse(s) as MergerArbData)
    .catch(() => null);

export default async function MergerArbPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international)
    return <UsOnlyNotice universe={universe} label="Merger Arb" relPath="/merger-arb" />;
  const data = await load();
  return <MergerArbView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), scanned: 0, deals: [] }} />;
}
