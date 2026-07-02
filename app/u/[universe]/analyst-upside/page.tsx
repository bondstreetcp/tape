import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildAnalystUpside } from "@/lib/analystUpside";
import type { EstimatesFile } from "@/lib/revisions";
import AnalystUpsideView from "@/components/AnalystUpsideView";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

// Analyst Upside — joins the nightly estimate snapshot (data/estimates.json: target/price/rating per
// name) with the current universe's snapshot. Refreshed by `npm run refresh-estimates`.
export default async function AnalystUpsidePage({ params }: { params: Promise<{ universe: string }> }) {
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

  const data = snap?.stocks && file ? buildAnalystUpside(file, snap.stocks) : null;
  if (!data || !data.rows.length) {
    return <EmptyState universe={universe} title="Analyst Upside" note="The S&P 500 is covered first — try that universe." />;
  }
  return <AnalystUpsideView data={data} universe={universe} />;
}
