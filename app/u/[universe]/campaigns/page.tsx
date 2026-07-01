import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { CampaignsData } from "@/lib/campaigns";
import CampaignsView from "@/components/CampaignsView";

export const dynamic = "force-dynamic";

function loadCampaigns(): Promise<CampaignsData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "campaigns.json"), "utf8")
    .then((s) => JSON.parse(s) as CampaignsData)
    .catch(() => null);
}

export default async function CampaignsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await loadCampaigns();
  return <CampaignsView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), scanned: 0, campaigns: [] }} />;
}
