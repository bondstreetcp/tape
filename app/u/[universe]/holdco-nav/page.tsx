import { notFound } from "next/navigation";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { HoldcoNavData } from "@/lib/holdco";
import HoldcoNavView from "@/components/HoldcoNavView";
import EmptyState from "@/components/EmptyState";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Holdco NAV tracker — universe-independent screener (lives under /u/[universe] to inherit the nav).
// Reads data/holdco-nav.json, built by `npm run refresh-holdco-nav`.
export default async function HoldcoNavPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  let data: HoldcoNavData | null = null;
  try {
    const p = join(process.cwd(), "data", "holdco-nav.json");
    if (existsSync(p)) data = JSON.parse(readFileSync(p, "utf8")) as HoldcoNavData;
  } catch {
    /* not built yet */
  }
  if (!data || !data.holdcos.length) {
    return <EmptyState universe={universe} title="Holdco NAV / Discount Tracker" />;
  }
  return <HoldcoNavView data={data} universe={universe} />;
}
