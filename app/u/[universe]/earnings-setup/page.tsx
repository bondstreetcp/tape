import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadEarningsMove } from "@/lib/earningsMove";
import EarningsSetupView from "@/components/EarningsSetupView";
import EmptyState from "@/components/EmptyState";
import UsOnlyNotice from "@/components/UsOnlyNotice";

export const dynamic = "force-dynamic";

// Earnings Setup Cards — a glanceable card deck of upcoming reporters (implied move vs. the stock's
// own history). Reuses data/earnings-move.json; the [universe] param drives nav + links.
export default async function EarningsSetupPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Earnings Setup Cards" relPath="/earnings-setup" />;

  const data = await loadEarningsMove();
  if (!data || !data.rows.length) {
    return <EmptyState universe={universe} title="Earnings Setup Cards" />;
  }
  const asOf = data.generatedAt ? new Date(data.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  return <EarningsSetupView universe={universe} rows={data.rows} asOf={asOf} />;
}
