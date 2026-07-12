import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { loadSuperInvestors } from "@/lib/superinvestors";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { ThirteenFStory } from "@/lib/thirteenFStory";
import SuperInvestorsView from "@/components/SuperInvestorsView";
import EmptyState from "@/components/EmptyState";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// GLM narrative of the quarter's consensus 13F rotation (scripts/refresh-13f-story.ts).
function loadStory(): Promise<ThirteenFStory | null> {
  return fs
    .readFile(path.join(process.cwd(), "data", "13f-story.json"), "utf8")
    .then((s) => JSON.parse(s) as ThirteenFStory)
    .catch(() => null);
}

// Curated value-manager 13F holdings. Universe-independent data (U.S. equities), but we pass
// the current universe's symbol set so a ticker only links when it lives in this universe.
export default async function SuperInvestorsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const [data, snapshot, story] = await Promise.all([loadSuperInvestors(), loadSnapshot(universe), loadStory()]);
  if (!data || !data.investors.length) {
    return <EmptyState universe={universe} title="Super-Investors" />;
  }
  const known = snapshot?.stocks.map((s) => s.symbol) ?? [];
  return <SuperInvestorsView universe={universe} data={data} known={known} story={story} />;
}
