/**
 * Board × Signal-Track-Record join — SERVER-ONLY fs wrapper around lib/signalLog's pure
 * joinFlagged() (which owns the semantics + tests). Import from server pages, never from a
 * "use client" file. Slim by construction: the log grows forever and must never ship to the
 * client; the page passes only the per-symbol map. Returns null (views degrade to plain
 * cards) when the log is absent or holds nothing for the board.
 */
import { promises as fs } from "fs";
import path from "path";
import { joinFlagged, type FlaggedInfo, type SignalKey, type SignalLogFile } from "./signalLog";

export async function loadFlaggedFor(signal: SignalKey, symbols: Set<string>): Promise<Record<string, FlaggedInfo> | null> {
  const log = await fs
    .readFile(path.join(process.cwd(), "data", "signal-log.json"), "utf8")
    .then((s) => JSON.parse(s) as SignalLogFile)
    .catch(() => null);
  if (!log) return null;
  return joinFlagged(log, signal, symbols);
}
