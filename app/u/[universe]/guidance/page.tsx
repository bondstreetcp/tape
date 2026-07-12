import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import type { GuidanceBoardData } from "@/lib/guidanceBoard";
import GuidanceBoardView from "@/components/GuidanceBoardView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function loadBoard(): Promise<GuidanceBoardData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "guidance-board.json"), "utf8")
    .then((s) => JSON.parse(s) as GuidanceBoardData)
    .catch(() => null);
}

export default async function GuidancePage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Guidance" relPath="/guidance" />;
  const data = await loadBoard();
  return <GuidanceBoardView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), scanned: 0, rows: [] }} />;
}
