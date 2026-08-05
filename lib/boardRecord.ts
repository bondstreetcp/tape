/**
 * Per-board track-record summary — the data behind the "this board's own hit rate" strip that
 * BoardTrackRecord renders on each idea board.
 *
 * WHY: the 2026-07-27 funda.ai gap analysis' #1 asymmetry — they don't appear to grade their picks;
 * we already do (/signal-record grades every board at 1w/1m/3m vs the S&P). But the receipts lived
 * ONLY on /signal-record, a page a visitor has to know to open. The strip puts each board's own
 * record ON the board, where the claim is being made.
 *
 * Thin wrapper over lib/signalLog's summarizeSignals — the same aggregation /signal-record renders,
 * so the strip and the scorecard cannot disagree. Server-only (reads data/signal-log.json).
 */
import { promises as fs } from "fs";
import path from "path";
import {
  summarizeSignals,
  SIGNAL_META,
  type SignalKey,
  type SignalLogFile,
  type SignalSummary,
} from "./signalLog";

export interface BoardRecordRow {
  signal: SignalKey;
  label: string;
  color: string;
  direction: "bullish" | "bearish" | "move";
  summary: SignalSummary;
}

/**
 * Load the graded record for one board's signal(s). Returns [] when the log has nothing for them
 * (pre-launch, non-US deploys, a brand-new board) — the strip renders nothing rather than a zero.
 */
export async function loadBoardRecord(signal: SignalKey | SignalKey[]): Promise<BoardRecordRow[]> {
  const keys = Array.isArray(signal) ? signal : [signal];
  let log: SignalLogFile | null = null;
  try {
    log = JSON.parse(await fs.readFile(path.join(process.cwd(), "data", "signal-log.json"), "utf8")) as SignalLogFile;
  } catch {
    return [];
  }
  if (!log?.events?.length) return [];
  const wanted = new Set(keys);
  const summaries = summarizeSignals(log.events.filter((e) => wanted.has(e.signal)));
  return summaries
    .filter((s) => s.events > 0)
    .map((s) => ({
      signal: s.signal,
      label: SIGNAL_META[s.signal].label,
      color: SIGNAL_META[s.signal].color,
      direction: SIGNAL_META[s.signal].direction,
      summary: s,
    }));
}
