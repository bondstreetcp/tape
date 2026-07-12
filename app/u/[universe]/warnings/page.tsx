import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { WarningsData } from "@/lib/warnings";
import { loadFlaggedFor } from "@/lib/flaggedJoin";
import WarningsView from "@/components/WarningsView";
import EmptyState from "@/components/EmptyState";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function loadWarnings(): Promise<WarningsData | null> {
  return fs
    .readFile(path.join(process.cwd(), "data", "warnings.json"), "utf8")
    .then((s) => JSON.parse(s) as WarningsData)
    .catch(() => null);
}

// Warning Signs — the bearish twin of the Confluence Engine, built over the Russell 3000; the data is
// the same regardless of universe, so the [universe] param only drives nav + stock-page links.
export default async function WarningsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const data = await loadWarnings();
  if (!data || !data.names.length) return <EmptyState universe={universe} title="Warning Signs" />;
  const flagged = await loadFlaggedFor("warnings", new Set(data.names.map((n) => n.symbol)));
  return <WarningsView universe={universe} data={data} flagged={flagged} />;
}
