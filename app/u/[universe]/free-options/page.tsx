import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import { buildFreeOptions } from "@/lib/freeOptions";
import type { EstimatesFile } from "@/lib/revisions";
import FreeOptionsView from "@/components/FreeOptionsView";
import SetupNotice from "@/components/SetupNotice";

// Built from the nightly snapshot + estimates feed; edge-cache the render.
export const revalidate = 3600;

function loadEstimates(): EstimatesFile | null {
  try {
    const p = join(process.cwd(), "data", "estimates.json");
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as EstimatesFile;
  } catch {
    return null;
  }
}

export default async function FreeOptionsPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const snap = await loadSnapshot(universe);
  if (!snap || snap.stocks.length === 0) return <SetupNotice />;
  const data = buildFreeOptions(snap.stocks, loadEstimates(), universe);
  return <FreeOptionsView data={data} universe={universe} />;
}
