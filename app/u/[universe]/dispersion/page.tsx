import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { DispersionData } from "@/lib/dispersion";
import DispersionView from "@/components/DispersionView";

export const dynamic = "force-dynamic";

function loadDisp(): Promise<DispersionData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "dispersion.json"), "utf8")
    .then((s) => JSON.parse(s) as DispersionData)
    .catch(() => null);
}

export default async function DispersionPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const data = await loadDisp();
  return <DispersionView universe={universe} data={data} />;
}
