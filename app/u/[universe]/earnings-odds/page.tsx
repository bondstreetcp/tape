import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import EmptyState from "@/components/EmptyState";
import EarningsOddsView from "@/components/EarningsOddsView";
import type { EarningsOddsFile } from "@/lib/earningsOdds";

export const revalidate = 600; // ISR: nightly data baked per deploy; edge-cache the render
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function loadOdds(): Promise<EarningsOddsFile | null> {
  return fs
    .readFile(path.join(process.cwd(), "data", "earnings-odds.json"), "utf8")
    .then((s) => JSON.parse(s) as EarningsOddsFile)
    .catch(() => null);
}

// Earnings Odds — Polymarket P(beat) × options-implied move × the desk's own forecast, with the
// code-computed consensus-vs-frozen-bar drift as the load-bearing column. US-only (the venue lists
// US single names; the joins are US feeds). Seasonal: an explicit out-of-season message, never a
// silently blank table — the venue lists these markets around each earnings season only.
export default async function EarningsOddsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  const meta = UNIVERSE_BY_ID[universe];
  if (!meta) notFound();
  if (meta.international) return <UsOnlyNotice universe={universe} label="Earnings Odds" relPath="/earnings-odds" dataNote="Polymarket's single-name earnings markets cover US reporters" />;

  const data = await loadOdds();
  if (!data) return <EmptyState universe={universe} title="Earnings Odds" note="Builds on the nightly refresh once the Polymarket scan has run." />;
  if (!data.rows.length)
    return (
      <EmptyState
        universe={universe}
        title="Earnings Odds"
        note={`No open single-name earnings markets right now — Polymarket lists them around each earnings season (last scan saw ${data.scanned} venue events, none forward and on-universe). The board fills back in as the next season's markets open.`}
      />
    );
  return <EarningsOddsView universe={universe} data={data} />;
}
