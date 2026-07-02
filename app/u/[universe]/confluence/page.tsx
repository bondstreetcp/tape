import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { ConfluenceData } from "@/lib/confluence";
import ConfluenceView from "@/components/ConfluenceView";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

function loadConfluence(): Promise<ConfluenceData | null> {
  return fs
    .readFile(path.join(process.cwd(), "data", "confluence.json"), "utf8")
    .then((s) => JSON.parse(s) as ConfluenceData)
    .catch(() => null);
}

// The Confluence Engine — a cross-market opportunity board (built over the Russell 3000), so the
// data is the same regardless of the current universe; the [universe] param only drives nav + the
// stock-page links.
export default async function ConfluencePage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const data = await loadConfluence();
  if (!data || !data.names.length) {
    return <EmptyState universe={universe} title="Confluence Engine" />;
  }
  return <ConfluenceView universe={universe} data={data} />;
}
