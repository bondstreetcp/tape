import { promises as fs } from "fs";
import path from "path";
import { notFound } from "next/navigation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { ConfluenceData, FlaggedInfo } from "@/lib/confluence";
import type { SignalLogFile, SignalEvent } from "@/lib/signalLog";
import ConfluenceView from "@/components/ConfluenceView";
import EmptyState from "@/components/EmptyState";

export const revalidate = 600; // ISR: nightly data is baked per deploy; edge-cache the render instead of running per visitor
export { universeStaticParams as generateStaticParams } from "@/lib/universeParams";

function loadConfluence(): Promise<ConfluenceData | null> {
  return fs
    .readFile(path.join(process.cwd(), "data", "confluence.json"), "utf8")
    .then((s) => JSON.parse(s) as ConfluenceData)
    .catch(() => null);
}

/** Join the board to the Signal Track Record log: for each board symbol, its latest confluence
 * entry (date + entry price) → "flagged {date} · ±x% since" on the card, plus a New badge for
 * fresh entrants on the latest tracked run. Slim map only — the log grows forever and must not
 * ship to the client. Null (and the view degrades) when the log is absent. */
async function loadFlagged(symbols: Set<string>): Promise<Record<string, FlaggedInfo> | null> {
  const log = await fs
    .readFile(path.join(process.cwd(), "data", "signal-log.json"), "utf8")
    .then((s) => JSON.parse(s) as SignalLogFile)
    .catch(() => null);
  if (!log?.events?.length) return null;
  const latest = new Map<string, SignalEvent>();
  for (const e of log.events) {
    if (e.signal !== "confluence" || !symbols.has(e.symbol) || !(e.entryPrice > 0)) continue;
    const p = latest.get(e.symbol);
    if (!p || e.date > p.date) latest.set(e.symbol, e);
  }
  if (!latest.size) return null;
  // The latest tracked run = the newest lastSeen stamp (every priced member is stamped each run).
  const seenDates = Object.values(log.lastSeen?.confluence ?? {});
  const lastRun = seenDates.length ? seenDates.reduce((a, b) => (a > b ? a : b)) : null;
  const out: Record<string, FlaggedInfo> = {};
  for (const [sym, e] of latest)
    out[sym] = { date: e.date, entryPrice: e.entryPrice, isNew: !e.seed && lastRun != null && e.date === lastRun, seed: !!e.seed };
  return out;
}

// The Confluence Engine — a cross-market opportunity board (built over the Russell 3000), so the
// data is the same regardless of the current universe; the [universe] param only drives nav + the
// stock-page links.
export default async function ConfluencePage({ params }: { params: Promise<{ universe: string }> }) {
  const { universe } = await params;
  if (!UNIVERSE_BY_ID[universe]) notFound();

  const data = await loadConfluence();
  if (!data || !data.names.length) {
    return <EmptyState universe={universe} title="Confluence Engine" />;
  }
  const flagged = await loadFlagged(new Set(data.names.map((n) => n.symbol)));
  return <ConfluenceView universe={universe} data={data} flagged={flagged} />;
}
