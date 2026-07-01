import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { IpoData } from "@/lib/ipoMonitor";
import IpoDetailView from "@/components/IpoDetailView";

export const dynamic = "force-dynamic";

function loadIpo(): Promise<IpoData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "ipo-monitor.json"), "utf8")
    .then((s) => JSON.parse(s) as IpoData)
    .catch(() => null);
}

export default async function IpoDetailPage({ params }: { params: Promise<{ universe: string; slug: string }> }) {
  const { universe, slug } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const raw = decodeURIComponent(slug);
  const upper = raw.toUpperCase();
  const data = await loadIpo();
  const event = data?.events.find((e) => (e.ticker && e.ticker.toUpperCase() === upper) || e.id === raw);
  if (!event) notFound();
  return <IpoDetailView universe={universe} event={event} />;
}
