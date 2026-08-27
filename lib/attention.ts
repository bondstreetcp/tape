/**
 * Attention / demand proxy — public interest measured by Wikipedia pageviews (Wikimedia's official,
 * free, keyless REST API). A stand-in for search-interest "demand": for a curated set of consumer,
 * tech & meme tickers plus a few economic-stress topics, we track daily article views, the week-over-
 * week move, and an "attention spike" z-score (this week vs the trailing ~90-day mean/σ). Spikes flag
 * a name (or a worry) suddenly in the public eye.
 *
 * CLIENT-SAFE: types + helpers only (no fs/network). Built by scripts/refresh-attention.ts, rendered by
 * <AttentionPanel/>. Decision-support, not advice.
 */
export type AttnGroup = "Big tech" | "Consumer & retail" | "Meme & momentum" | "Economic stress";

export interface AttnItem {
  key: string;
  label: string;
  ticker?: string; // company items link to the stock page; topics have none
  group: AttnGroup;
  latest: number; // latest 7-day average daily pageviews
  latestDate: string;
  wowPct: number | null; // 7-day avg vs the prior 7-day avg
  spikeZ: number | null; // (latest 7d avg − trailing ~90d mean) / trailing σ
  history: [string, number][]; // weekly-sampled daily views, oldest→newest
}

export interface AttentionData {
  asOf: string;
  items: AttnItem[];
}

export const ATTN_GROUP_ORDER: AttnGroup[] = ["Big tech", "Consumer & retail", "Meme & momentum", "Economic stress"];

/** Compact view count: 12345 → "12.3k", 1234567 → "1.2M". */
export function fmtViews(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(1)}k`;
  return `${Math.round(v)}`;
}

export function fmtPct(v: number | null): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(0)}%`;
}

/** A spike z-score → its read + colour. High = surging attention (worth a look). */
export function spikeRead(z: number | null): { label: string; color: string } {
  if (z == null) return { label: "—", color: "var(--text-3)" };
  if (z >= 2) return { label: "spiking", color: "#ef4444" };
  if (z >= 1) return { label: "elevated", color: "#f59e0b" };
  if (z <= -1) return { label: "quiet", color: "#60a5fa" };
  return { label: "normal", color: "var(--text-3)" };
}

export function pctColor(v: number | null): string {
  if (v == null || v === 0) return "var(--text-3)";
  return v > 0 ? "#22c55e" : "#ef4444";
}
