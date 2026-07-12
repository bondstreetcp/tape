import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { loadSnapshot } from "@/lib/data";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import { buildCatalystCalendar } from "@/lib/catalystCalendar";
import type { SnapshotEarnings } from "@/lib/portfolioCatalysts";
import PortfolioRadar from "@/components/PortfolioRadar";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";
const DAY = 86_400_000;

const read = (f: string): Promise<any> =>
  fsp.readFile(path.join(process.cwd(), "data", f), "utf8").then((s) => JSON.parse(s)).catch(() => null);

// Portfolio Catalyst Radar — the full forward calendar is built server-side (all names); the client
// reads the pasted book from localStorage and filters to it, so the holdings never leave the browser.
export default async function PortfolioRadarPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international)
    return <UsOnlyNotice universe={universe} label="Portfolio Radar" relPath="/portfolio-radar" dataNote="The catalyst feeds (earnings, biotech readouts, IPO lockups) are built from US-market data" />;

  const [earnings, investorDays, biotech, lockups, r3k] = await Promise.all([
    read("earnings-move.json"),
    read("catalyst-vol.json"),
    read("biotech-catalysts.json"),
    read("ipo-monitor.json"),
    loadSnapshot("russell3000"),
  ]);
  const now = Date.now();
  const events = buildCatalystCalendar({ earnings, investorDays, biotech, lockups }, now, { horizonDays: 120 });

  // Forward earnings dates for the broad US universe (Russell 3000) — supplements the ≤16-day options
  // feed so a holding reporting later this quarter still surfaces. Keyed by symbol, forward-only, ≤120d.
  const earningsDates: Record<string, SnapshotEarnings> = {};
  for (const s of r3k?.stocks ?? []) {
    if (!s.earningsDate) continue;
    const t = Date.parse(s.earningsDate);
    if (!Number.isFinite(t) || t < now - DAY || t > now + 120 * DAY) continue;
    earningsDates[s.symbol] = { date: new Date(t).toISOString().slice(0, 10), name: s.name, estimated: !!s.earningsEstimate };
  }
  const generatedAt = earnings?.generatedAt ?? investorDays?.generatedAt ?? new Date().toISOString();

  return <PortfolioRadar universe={universe} events={events} earningsDates={earningsDates} generatedAt={generatedAt} />;
}
