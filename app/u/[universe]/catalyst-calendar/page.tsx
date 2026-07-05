import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import { buildCatalystCalendar } from "@/lib/catalystCalendar";
import CalendarView from "@/components/CalendarView";

export const dynamic = "force-dynamic";

const read = (f: string): Promise<any> =>
  fsp.readFile(path.join(process.cwd(), "data", f), "utf8").then((s) => JSON.parse(s)).catch(() => null);

export default async function CatalystCalendarPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international)
    return <UsOnlyNotice universe={universe} label="Catalyst Calendar" relPath="/catalyst-calendar" />;

  // Pure aggregation of existing forward-dated feeds (no new pipeline) — computed fresh per request.
  const [earnings, investorDays, biotech, lockups] = await Promise.all([
    read("earnings-move.json"),
    read("catalyst-vol.json"),
    read("biotech-catalysts.json"),
    read("ipo-monitor.json"),
  ]);
  const events = buildCatalystCalendar({ earnings, investorDays, biotech, lockups }, Date.now(), { horizonDays: 120 });
  const generatedAt = earnings?.generatedAt ?? investorDays?.generatedAt ?? new Date().toISOString();

  return <CalendarView universe={universe} events={events} generatedAt={generatedAt} />;
}
