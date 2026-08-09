import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { summarizeSignals, type SignalLogFile } from "@/lib/signalLog";
import { buildIdeaInbox } from "@/lib/ideaInbox";
import IdeaInboxView from "@/components/IdeaInboxView";
import EmptyState from "@/components/EmptyState";
import UsOnlyNotice from "@/components/UsOnlyNotice";

export const revalidate = 600; // ISR: the signal log is nightly data — edge-cache the render
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

// Idea Inbox — what ARRIVED across the idea boards, fused by name and weighted by each board's own
// graded record. A pure view over data/signal-log.json (the /signal-record source of truth): no new
// feed, no LLM — the accountable log decides what counts as an arrival and what a board's word is
// worth. US-keyed (the graded boards are US scans).
export default async function IdeasPage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();
  if (UNIVERSE_BY_ID[universe].international) {
    return <UsOnlyNotice universe={universe} label="Idea Inbox" relPath="/ideas" dataNote="The inbox fuses the US idea boards (Confluence, Revisions, Insiders, Squeeze…), which scan US-listed names" />;
  }

  let log: SignalLogFile | null = null;
  try {
    log = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "signal-log.json"), "utf8")) as SignalLogFile;
  } catch { /* pre-launch box */ }
  if (!log?.events?.length) {
    return <EmptyState universe={universe} title="Idea Inbox" note="The inbox fills as the signal log accumulates board arrivals — check back after a nightly run or two." />;
  }

  // includeSeed default matches the BoardTrackRecord strips, so the weights here equal the record
  // the user sees on every board — one scoreboard, never two.
  const inbox = buildIdeaInbox(log.events, summarizeSignals(log.events), { windowDays: 14, nowMs: Date.now() });
  return <IdeaInboxView universe={universe} inbox={inbox} generatedAt={log.generatedAt} />;
}
