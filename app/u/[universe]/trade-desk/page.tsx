import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { TradeDeskData } from "@/lib/tradeIdeas";
import TradeDeskView from "@/components/TradeDeskView";
import UsOnlyNotice from "@/components/UsOnlyNotice";

export const dynamic = "force-dynamic";

function loadDesk(): Promise<TradeDeskData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "trade-ideas.json"), "utf8")
    .then((s) => JSON.parse(s) as TradeDeskData)
    .catch(() => null);
}

export default async function TradeDeskPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Trade Desk" relPath="/trade-desk" />;
  const data = await loadDesk();
  return <TradeDeskView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), weekOf: "", pool: 0, ideas: [] }} />;
}
