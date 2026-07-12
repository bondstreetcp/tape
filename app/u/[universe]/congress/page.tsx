import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { loadCongress, loadTrump } from "@/lib/congress";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { CongressSummary } from "@/lib/congressSummary";
import CongressView from "@/components/CongressView";
import EmptyState from "@/components/EmptyState";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// AI "what's notable" summary of the trades (scripts/refresh-congress-summary.ts).
function loadCongressSummary(): Promise<CongressSummary | null> {
  return fs
    .readFile(path.join(process.cwd(), "data", "congress-summary.json"), "utf8")
    .then((s) => JSON.parse(s) as CongressSummary)
    .catch(() => null);
}

// Congressional (Senate STOCK Act) trades. Universe-independent data; the current universe's
// symbol set is passed so a ticker only links when it lives in this universe.
export default async function CongressPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const [data, trump, snapshot, summary] = await Promise.all([loadCongress(), loadTrump(), loadSnapshot(universe), loadCongressSummary()]);
  if (!data || !data.trades.length) {
    return <EmptyState universe={universe} title="Congressional Trading" />;
  }
  const known = snapshot?.stocks.map((s) => s.symbol) ?? [];
  return <CongressView universe={universe} data={data} trump={trump} known={known} summary={summary} />;
}
