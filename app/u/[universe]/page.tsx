import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { loadSnapshot } from "@/lib/data";
import { loadCatalysts } from "@/lib/catalysts";
import { loadDeskNote } from "@/lib/deskNote";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { SignalLogFile } from "@/lib/signalLog";
import HomeDashboard from "@/components/HomeDashboard";
import MorningStrip from "@/components/MorningStrip";
import SetupNotice from "@/components/SetupNotice";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Idea-inbox arrival counts for the morning strip — the same signal-log facts /ideas fuses, cheap
// calendar-day counts here (seeds excluded; they're a board's launch backlog, not arrivals).
async function ideaArrivalCounts(): Promise<{ today: number; week: number } | null> {
  try {
    const log = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "signal-log.json"), "utf8")) as SignalLogFile;
    const DAY = 86_400_000;
    const todayMs = Math.floor(Date.now() / DAY) * DAY;
    let today = 0, week = 0;
    for (const e of log.events ?? []) {
      if (e.seed) continue;
      const t = Date.parse(e.date);
      if (!Number.isFinite(t)) continue;
      const d = Math.round((todayMs - t) / DAY);
      if (d === 0) today++;
      if (d >= 0 && d <= 7) week++;
    }
    return { today, week };
  } catch { return null; }
}

export default async function UniverseHome({
  params,
}: {
  params: Promise<{ universe: string }>;
}) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  const intl = !!UNIVERSE_BY_ID[universe].international;
  const [snapshot, catalysts, note, ideas] = await Promise.all([
    loadSnapshot(universe),
    loadCatalysts(),
    loadDeskNote().catch(() => null),
    intl ? Promise.resolve(null) : ideaArrivalCounts(), // the idea boards are US scans
  ]);
  if (!snapshot || snapshot.stocks.length === 0) return <SetupNotice />;
  return (
    <HomeDashboard
      snapshot={snapshot}
      universe={universe}
      catalysts={catalysts}
      morningStrip={
        <MorningStrip
          universe={universe}
          desk={note ? { generatedAt: note.generatedAt, run: note.run ?? "morning" } : null}
          ideasToday={ideas?.today ?? null}
          ideasWeek={ideas?.week ?? null}
        />
      }
    />
  );
}
