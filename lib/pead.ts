/**
 * Post-earnings drift (PEAD) — names that reported recently and are still drifting in the direction of the
 * initial reaction. Pure price signal: the earnings GAP is the market's reaction to the surprise (the
 * larger of the filing-day or next-session move, so before-open AND after-close reports are captured); the
 * DRIFT since is the continuation. When drift keeps going the gap's way, that's the PEAD momentum trade.
 * Built nightly from the earnings dates (guidance history) + the local daily series (scripts/refresh-pead.ts).
 * Client-safe types + helpers only.
 */
export interface PeadRow {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  reportedAt: string; // YYYY-MM-DD of the earnings report
  daysSince: number;
  gapPct: number; // the earnings reaction — larger of the filing-day / next-session close-to-close move, %
  driftPct: number; // cumulative return since the reaction session, %
  continuation: boolean; // drift in the SAME direction as the gap (PEAD momentum) vs a fade
  reportedEps: number | null;
}
export interface PeadData {
  generatedAt: string;
  scanned: number;
  rows: PeadRow[];
}

// The move color: green up, red down.
export const moveColor = (x: number): string => (x > 0 ? "#22c55e" : x < 0 ? "#ef4444" : "var(--text-3)");
