import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import EarningsWeekView, { type EmData } from "@/components/EarningsWeekView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function loadEm(): Promise<EmData | null> {
  return fsp
    .readFile(path.join(process.cwd(), "data", "earnings-move.json"), "utf8")
    .then((s) => JSON.parse(s) as EmData)
    .catch(() => null);
}

export default async function EarningsWeekPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Earnings This Week" relPath="/earnings-week" />;
  // The feed is one global US scan, built over the Russell 3000. NARROW universes filter it to their
  // constituents so the switcher actually changes the list; BROAD universes show the FULL feed. Filtering
  // a broad universe to its snapshot silently dropped genuine small-cap / R3000-only reporters like OLLI
  // (the 2026-08-29 miss) — and any snapshot bake-lag drops recent additions. So: to see EVERY reporter,
  // pick Russell 1000 / Broad 1500 / Russell 3000 (narrow S&P 500 / Nasdaq 100 stay scoped by design).
  const BROAD_US = new Set(["russell1000", "sp1500", "russell3000"]);
  const [data, snap] = await Promise.all([loadEm(), loadSnapshot(universe)]);
  const base = data ?? { generatedAt: new Date().toISOString(), windowDays: 16, rows: [] };
  const syms = !BROAD_US.has(universe) && snap ? new Set(snap.stocks.map((s) => s.symbol)) : null;
  const rows = syms ? base.rows.filter((r) => syms.has(r.symbol)) : base.rows;
  return <EarningsWeekView universe={universe} data={{ ...base, rows }} />;
}
