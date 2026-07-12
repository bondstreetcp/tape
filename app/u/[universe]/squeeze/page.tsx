import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildSqueeze } from "@/lib/shortSqueeze";
import type { EstimatesFile } from "@/lib/revisions";
import SqueezeView from "@/components/SqueezeView";
import EmptyState from "@/components/EmptyState";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Short-Squeeze Radar — joins the per-name short-interest block in the nightly estimate snapshot
// (data/estimates.json, US-only) with the current universe's snapshot.
export default async function SqueezePage({ params }: { params: Promise<{ universe: string }> }) {
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

  const data = snap?.stocks && file ? buildSqueeze(file, snap.stocks) : null;
  if (!data || !data.rows.length) {
    return <EmptyState universe={universe} title="Short-Squeeze Radar" note="US names only — try the S&P 500 or a broad US universe." />;
  }
  return <SqueezeView data={data} universe={universe} />;
}
