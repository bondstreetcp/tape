import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import { buildBinaryWeek } from "@/lib/binaryWeek";
import BinaryWeekView from "@/components/BinaryWeekView";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

const read = (f: string): Promise<any> =>
  fsp.readFile(path.join(process.cwd(), "data", f), "utf8").then((s) => JSON.parse(s)).catch(() => null);

export default async function BinaryWeekPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) return <UsOnlyNotice universe={universe} label="Binary Events" relPath="/binary-week" />;

  // Pure impact-ranked join over existing forward feeds (no new pipeline). We compute a 30-day window
  // server-side and let the view narrow it (7 / 14 / 30d) client-side.
  const [earnings, investorDays, biotech, biotechVol, lockups] = await Promise.all([
    read("earnings-move.json"),
    read("catalyst-vol.json"),
    read("biotech-catalysts.json"),
    read("biotech-vol.json"),
    read("ipo-monitor.json"),
  ]);
  const events = buildBinaryWeek(
    { earnings: earnings?.rows, investorDays: investorDays?.rows, biotech: biotech?.items, biotechVol: biotechVol?.rows, lockups: lockups?.events },
    Date.now(),
    { horizonDays: 30 },
  );
  const generatedAt = biotech?.generatedAt ?? earnings?.generatedAt ?? new Date().toISOString();

  return <BinaryWeekView universe={universe} events={events} generatedAt={generatedAt} />;
}
