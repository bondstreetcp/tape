import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import type { VolConeData } from "@/lib/volCone";
import { dealTags, type MergerArbFile } from "@/lib/mergerArb";
import VolConeView from "@/components/VolConeView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

const load = (): Promise<VolConeData | null> =>
  fsp
    .readFile(path.join(process.cwd(), "data", "vol-cone.json"), "utf8")
    .then((s) => JSON.parse(s) as VolConeData)
    .catch(() => null);

// Live merger targets (DEFM14A) — used to flag deal-pinned names whose low realized vol is the pending
// deal, not a coiled spring. Global US feed; degrades to no annotations if absent.
const loadDeals = (): Promise<MergerArbFile | null> =>
  fsp
    .readFile(path.join(process.cwd(), "data", "merger-arb.json"), "utf8")
    .then((s) => JSON.parse(s) as MergerArbFile)
    .catch(() => null);

export default async function VolConePage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  // Universe-agnostic: the cone is pure realized vol, so it works for US + intl. The feed is global
  // (one row per name across all universes); filter to THIS universe's constituents.
  const [data, snap, deals] = await Promise.all([load(), loadSnapshot(universe), loadDeals()]);
  const syms = new Set((snap?.stocks ?? []).map((s) => s.symbol?.toUpperCase()));
  const rows = (data?.rows ?? []).filter((r) => syms.has(r.symbol.toUpperCase()));
  return <VolConeView universe={universe} data={{ generatedAt: data?.generatedAt ?? new Date().toISOString(), horizons: data?.horizons ?? [], rows }} deals={dealTags(deals)} />;
}
