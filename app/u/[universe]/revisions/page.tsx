import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildRevisions, type EstimatesFile } from "@/lib/revisions";
import RevisionsView from "@/components/RevisionsView";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

// Revisions Momentum — joins the nightly estimate snapshot (data/estimates.json) with the current
// universe's snapshot. Estimate revisions are refreshed by `npm run refresh-estimates`.
export default async function RevisionsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const snap = await loadSnapshot(universe);
  let file: EstimatesFile | null = null;
  try {
    const p = join(process.cwd(), "data", "estimates.json");
    if (existsSync(p)) file = JSON.parse(readFileSync(p, "utf8")) as EstimatesFile;
  } catch {
    /* no estimates file yet */
  }

  const data = snap?.stocks && file ? buildRevisions(file, snap.stocks) : null;
  if (!data || !data.rows.length) {
    return <EmptyState universe={universe} title="Revisions Momentum" note="The S&P 500 is covered first — try that universe." />;
  }
  return <RevisionsView data={data} universe={universe} />;
}
