import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildInsiderBuys, type InsidersFile } from "@/lib/insiders";
import InsidersView from "@/components/InsidersView";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

// Insider Cluster-Buying — joins the nightly Form 4 buy scan (data/insiders.json) with the current
// universe's snapshot. Refreshed by `npm run refresh-insiders`.
export default async function InsidersPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const snap = await loadSnapshot(universe);
  let file: InsidersFile | null = null;
  try {
    const p = join(process.cwd(), "data", "insiders.json");
    if (existsSync(p)) file = JSON.parse(readFileSync(p, "utf8")) as InsidersFile;
  } catch {
    /* no insiders file yet */
  }

  const data = snap?.stocks && file ? buildInsiderBuys(file, snap.stocks) : null;
  if (!data) {
    return <EmptyState universe={universe} title="Insider Cluster-Buying" note="US names only — try the S&P 500 or a broad US universe." />;
  }
  return <InsidersView data={data} universe={universe} />;
}
