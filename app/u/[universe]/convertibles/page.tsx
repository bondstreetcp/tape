import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { ConvertiblesData } from "@/lib/convertible";
import ConvertiblesView from "@/components/ConvertiblesView";
import UsOnlyNotice from "@/components/UsOnlyNotice";

export const revalidate = 600; // ISR: nightly data baked per deploy; edge-cache the render
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function loadConvertibles(): Promise<ConvertiblesData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "convertibles.json"), "utf8")
    .then((s) => JSON.parse(s) as ConvertiblesData)
    .catch(() => null);
}

export default async function ConvertiblesPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Convertible Watch" relPath="/convertibles" />;
  const data = await loadConvertibles();
  return <ConvertiblesView universe={universe} data={data ?? { generatedAt: new Date().toISOString(), rows: [] }} />;
}
