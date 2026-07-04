import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { PeadData } from "@/lib/pead";
import PeadView from "@/components/PeadView";
import UsOnlyNotice from "@/components/UsOnlyNotice";

export const dynamic = "force-dynamic";

function loadPead(): Promise<PeadData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "pead.json"), "utf8")
    .then((s) => JSON.parse(s) as PeadData)
    .catch(() => null);
}

export default async function PeadPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Post-Earnings Drift" relPath="/pead" />;
  const data = await loadPead();
  return <PeadView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), scanned: 0, rows: [] }} />;
}
