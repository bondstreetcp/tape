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
  // The feed is one global US scan — filter it to the SELECTED universe's constituents so the
  // universe switcher actually changes the list (it used to only change link prefixes).
  const [data, snap] = await Promise.all([loadEm(), loadSnapshot(universe)]);
  const base = data ?? { generatedAt: new Date().toISOString(), windowDays: 16, rows: [] };
  const syms = snap ? new Set(snap.stocks.map((s) => s.symbol)) : null;
  const rows = syms ? base.rows.filter((r) => syms.has(r.symbol)) : base.rows;
  return <EarningsWeekView universe={universe} data={{ ...base, rows }} />;
}
