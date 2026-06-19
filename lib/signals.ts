import type { StockRow } from "./types";

export interface Signal {
  key: string;
  short: string;
  label: string;
  tone: "up" | "down" | "neutral";
}

/**
 * Snapshot-based "alert" signals for a stock — 52-week extremes and 50/200-day
 * moving-average position. These are current-state signals (no event history).
 */
export function computeSignals(s: StockRow, nearPct = 1.5): Signal[] {
  const out: Signal[] = [];

  if (s.pctFromHigh >= -nearPct) {
    out.push({
      key: "high",
      short: "52wH",
      label: s.pctFromHigh >= -0.1 ? "At 52-week high" : "Near 52-week high",
      tone: "up",
    });
  } else if (s.pctFromLow <= nearPct) {
    out.push({
      key: "low",
      short: "52wL",
      label: s.pctFromLow <= 0.1 ? "At 52-week low" : "Near 52-week low",
      tone: "down",
    });
  }

  const ma200 = s.twoHundredDayAverage;
  const ma50 = s.fiftyDayAverage;
  if (ma200 != null && s.price) {
    const above = s.price >= ma200;
    const dist = Math.abs(s.price / ma200 - 1) * 100;
    if (dist <= 2) {
      out.push({
        key: "cross",
        short: "~200d",
        label: `Near 200-day MA (${above ? "just above" : "just below"})`,
        tone: "neutral",
      });
    } else {
      out.push({
        key: "ma200",
        short: above ? "↑200d" : "↓200d",
        label: above ? "Above 200-day MA" : "Below 200-day MA",
        tone: above ? "up" : "down",
      });
    }
  }

  if (ma50 != null && ma200 != null) {
    if (ma50 > ma200) out.push({ key: "golden", short: "50>200", label: "Golden cross (50d above 200d)", tone: "up" });
    else out.push({ key: "death", short: "50<200", label: "Death cross (50d below 200d)", tone: "down" });
  }

  return out;
}

export const TONE_BG: Record<Signal["tone"], string> = {
  up: "#0f2a1a",
  down: "#2a1414",
  neutral: "#1a1f2e",
};
export const TONE_FG: Record<Signal["tone"], string> = {
  up: "#22c55e",
  down: "#ef4444",
  neutral: "#8b93a7",
};
