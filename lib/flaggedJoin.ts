/**
 * Board × Signal-Track-Record join — for each symbol on an idea board, its latest log entry
 * (date + entry price) so the board card can show "±x% since flagged" + a New badge. SERVER-ONLY
 * (reads data/signal-log.json with fs — import from server pages, never from a "use client" file).
 * Slim by construction: the log grows forever and must never ship to the client; the page passes
 * only this per-symbol map. Returns null (and the views degrade to plain cards) when the log is
 * absent or holds nothing for the board.
 */
import { promises as fs } from "fs";
import path from "path";
import type { FlaggedInfo, SignalEvent, SignalKey, SignalLogFile } from "./signalLog";

export async function loadFlaggedFor(signal: SignalKey, symbols: Set<string>): Promise<Record<string, FlaggedInfo> | null> {
  const log = await fs
    .readFile(path.join(process.cwd(), "data", "signal-log.json"), "utf8")
    .then((s) => JSON.parse(s) as SignalLogFile)
    .catch(() => null);
  if (!log?.events?.length) return null;
  const latest = new Map<string, SignalEvent>();
  for (const e of log.events) {
    if (e.signal !== signal || !symbols.has(e.symbol) || !(e.entryPrice > 0)) continue;
    const p = latest.get(e.symbol);
    if (!p || e.date > p.date) latest.set(e.symbol, e);
  }
  if (!latest.size) return null;
  // The latest tracked run = the newest lastSeen stamp (every priced member is stamped each run).
  const seenDates = Object.values(log.lastSeen?.[signal] ?? {});
  const lastRun = seenDates.length ? seenDates.reduce((a, b) => (a > b ? a : b)) : null;
  const out: Record<string, FlaggedInfo> = {};
  for (const [sym, e] of latest)
    out[sym] = { date: e.date, entryPrice: e.entryPrice, isNew: !e.seed && lastRun != null && e.date === lastRun, seed: !!e.seed };
  return out;
}
