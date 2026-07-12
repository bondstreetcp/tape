import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { loadEarningsMove } from "@/lib/earningsMove";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import EarningsCalendar, { type Setup } from "@/components/EarningsCalendar";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

export default async function EarningsPage({
  params,
}: {
  params: Promise<{ universe: string }>;
}) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const [snapshot, emove] = await Promise.all([loadSnapshot(universe), loadEarningsMove().catch(() => null)]);
  if (!snapshot) notFound();
  // The options-priced setup (implied move + rich/cheap vs history) for the near-term reporters
  // with an options chain — keyed by symbol so the calendar can show it inline.
  const setups: Record<string, Setup> = {};
  for (const r of emove?.rows || []) if (r.impliedMovePct != null) setups[r.symbol] = { impliedMove: r.impliedMovePct, richness: r.richness, histAvgMove: r.histAvgMovePct };
  return (
    <EarningsCalendar universe={universe} stocks={snapshot.stocks} generatedAt={snapshot.generatedAt} setups={setups} />
  );
}
