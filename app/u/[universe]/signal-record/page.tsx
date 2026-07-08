import { notFound } from "next/navigation";
import { promises as fsp } from "fs";
import path from "path";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UsOnlyNotice from "@/components/UsOnlyNotice";
import EmptyState from "@/components/EmptyState";
import SignalRecordView from "@/components/SignalRecordView";
import { summarizeSignals, type SignalLogFile } from "@/lib/signalLog";

export const dynamic = "force-dynamic";

// Signal Track Record — grades every idea board on what its picks actually did next. The summary is
// computed server-side over the FULL forward-accumulating log; only the latest slice of raw events
// ships to the client, so the payload stays flat as the log grows. US-only (the logged boards read
// US feeds).
const EVENTS_SHOWN = 400;

export default async function SignalRecordPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international)
    return <UsOnlyNotice universe={universe} label="Signal Track Record" relPath="/signal-record" dataNote="This record grades the US idea boards (Confluence, Warnings, Squeeze…), which are built on US-market feeds" />;

  const log = await fsp
    .readFile(path.join(process.cwd(), "data", "signal-log.json"), "utf8")
    .then((s) => JSON.parse(s) as SignalLogFile)
    .catch(() => null);
  if (!log?.events?.length) return <EmptyState universe={universe} title="Signal Track Record" note="The log starts accruing on the next nightly run — every idea board's picks get graded from that day forward." />;

  const summariesAll = summarizeSignals(log.events);
  const summariesFresh = summarizeSignals(log.events, { includeSeed: false });
  const latest = [...log.events].sort((a, b) => b.date.localeCompare(a.date) || a.signal.localeCompare(b.signal)).slice(0, EVENTS_SHOWN);

  return (
    <SignalRecordView
      universe={universe}
      summariesAll={summariesAll}
      summariesFresh={summariesFresh}
      events={latest}
      totalEvents={log.events.length}
      since={log.since}
      generatedAt={log.generatedAt}
    />
  );
}
