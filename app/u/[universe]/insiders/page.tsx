import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildInsiderBuys, type InsidersFile } from "@/lib/insiders";
import InsidersView from "@/components/InsidersView";
import EmptyState from "@/components/EmptyState";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import type { Snapshot } from "@/lib/types";

export const dynamic = "force-dynamic";

// Insider Cluster-Buying — the nightly Form 4 open-market-buy scan (data/insiders.json). Open-market
// insider buying is overwhelmingly a SMALL/MID-CAP signal (mega-cap officers rarely buy with cash), so
// the board joins against the BROADEST US universe (Russell 3000), NOT the selected one — otherwise it
// collapses to ~1 name on the S&P 500. It's a US-wide board regardless of the universe in the URL.
async function loadBroadUs(): Promise<Snapshot | null> {
  for (const u of ["russell3000", "broad1500", "russell1000", "sp1500", "sp500", "nasdaq100"]) {
    const snap = await loadSnapshot(u);
    if (snap?.stocks?.length) return snap;
  }
  return null;
}

export default async function InsidersPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Insider Cluster-Buying" relPath="/insiders" />;

  const snap = await loadBroadUs();
  let file: InsidersFile | null = null;
  try {
    const p = join(process.cwd(), "data", "insiders.json");
    if (existsSync(p)) file = JSON.parse(readFileSync(p, "utf8")) as InsidersFile;
  } catch {
    /* no insiders file yet */
  }

  const data = snap?.stocks && file ? buildInsiderBuys(file, snap.stocks) : null;
  if (!data || data.rows.length === 0) {
    return <EmptyState universe={universe} title="Insider Cluster-Buying" note="No open-market insider buys in the current window yet — this fills on the nightly Form 4 scan." />;
  }
  return <InsidersView data={data} universe={universe} />;
}
