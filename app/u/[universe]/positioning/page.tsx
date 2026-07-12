import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import EmptyState from "@/components/EmptyState";
import { buildPositioning } from "@/lib/positioning";
import PositioningView from "@/components/PositioningView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

const read = (f: string): Promise<any> =>
  fsp.readFile(path.join(process.cwd(), "data", f), "utf8").then((s) => JSON.parse(s)).catch(() => null);

// Positioning Radar — the name-level roll-up of the options-flow tape (data/options-flow.json), joined to
// the dated catalyst feeds. Pure page-load join over existing artifacts (no new pipeline). US-only: the
// flow snapshot is S&P 500 single-stock options.
export default async function PositioningPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Positioning Radar" relPath="/positioning" />;

  const [flow, earnings, biotech, investorDays] = await Promise.all([
    read("options-flow.json"),
    read("earnings-move.json"),
    read("biotech-catalysts.json"),
    read("catalyst-vol.json"),
  ]);
  if (!flow?.entries?.length) return <EmptyState universe={universe} title="Positioning Radar" />;

  const rows = buildPositioning(
    flow.entries,
    { earnings: earnings?.rows, biotech: biotech?.items, investorDays: investorDays?.rows },
    Date.now(),
  );

  return (
    <PositioningView
      universe={universe}
      rows={rows}
      generatedAt={flow.generatedAt}
      callPremium={flow.callPremium ?? null}
      putPremium={flow.putPremium ?? null}
    />
  );
}
