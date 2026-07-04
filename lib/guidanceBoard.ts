/**
 * Guidance board — a cross-sectional view of company GUIDANCE credibility. Joins data/guidance.json (the
 * LLM-extracted standing guides + the actual-vs-next-quarter-guide history, per lib/guidance) with a
 * universe snapshot for name/sector/price/next-earnings, and tags each name by how it treats its own guide:
 *
 *   sandbagger    — guides low then reliably beats (the guide is a floor; bullish read into the print)
 *   over-promiser — reliably misses its own guide (fade the guide)
 *   steady        — has a track record but neither extreme
 *
 * Built by scripts/refresh-guidance-board.ts → data/guidance-board.json (nightly, after refresh-guidance).
 * This module is client-safe (types + the pure tag/label helpers only).
 */
import type { GuidanceAction } from "./guidance";

export type GuidanceTag = "sandbagger" | "over-promiser" | "steady";

export interface GuidanceBoardRow {
  symbol: string;
  name: string;
  sector: string;
  price: number | null;
  period: string; // what the standing guide covers, e.g. "FY2026"
  action: GuidanceAction; // raise / reaffirm / cut / initiate / mixed / none (vs the prior outlook)
  revLowM: number | null;
  revHighM: number | null;
  epsLow: number | null;
  epsHigh: number | null;
  confidence?: "high" | "medium" | "low";
  updated: string; // the 8-K date the guide is from
  sourceUrl: string | null;
  sourceForm: string | null;
  beats: number | null; // "beats its own guide" track record (null until ≥2 comparable quarters)
  total: number | null;
  avgVsGuide: number | null; // mean actual ÷ guide-midpoint − 1
  tag: GuidanceTag | null;
  nextEarnings: string | null;
  daysToEarnings: number | null;
}

export interface GuidanceBoardData {
  generatedAt: string;
  scanned: number;
  rows: GuidanceBoardRow[];
}

/** Classify a name from its beat-its-own-guide record. null until ≥2 comparable quarters. */
export function guidanceTag(beats: number | null, total: number | null, avgVsGuide: number | null): GuidanceTag | null {
  if (beats == null || total == null || total < 2) return null;
  const rate = beats / total;
  const avg = avgVsGuide ?? 0;
  if (rate >= 0.8 && avg > 0.01) return "sandbagger";
  if (rate >= 0.7) return "steady"; // a strong beater is never an over-promiser, even if a noisy avg says so
  if (rate <= 0.4 || avg < -0.02) return "over-promiser";
  return "steady";
}

export const tagColor = (t: GuidanceTag | null): string =>
  t === "sandbagger" ? "#22c55e" : t === "over-promiser" ? "#ef4444" : t === "steady" ? "var(--text-3)" : "var(--text-4)";

export const tagLabel = (t: GuidanceTag | null): string =>
  t === "sandbagger" ? "sandbagger" : t === "over-promiser" ? "over-promiser" : t === "steady" ? "steady" : "—";

// raise = green, cut = red, reaffirm/none = neutral, initiate/mixed = amber
export const actionColor = (a: GuidanceAction): string =>
  a === "raise" ? "#22c55e" : a === "cut" ? "#ef4444" : a === "initiate" || a === "mixed" ? "#f59e0b" : "var(--text-3)";
