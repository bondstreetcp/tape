import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import GuideView from "@/components/GuideView";

// The Guide — a plain-English manual for every feature + metric, for a finance-101 reader. Pure static
// content (lib/guideContent.ts); the [universe] only scopes the in-guide links to the current universe.
export default async function GuidePage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  return <GuideView universe={universe} />;
}
