/**
 * Fed Watch — an LLM digest of Federal Reserve communications (FOMC statements/minutes, Fed-speaker
 * speeches, the Beige Book) scored on the hawkish↔dovish spectrum with a "what changed" read, so you
 * get the policy NARRATIVE next to the FRED numbers. Built by scripts/refresh-fed.ts → data/fed-watch.json.
 *
 * CLIENT-SAFE: types + pure helpers only (no fs). The page reads the JSON server-side.
 */

export type Bias = "hawkish" | "dovish" | "neutral";
export type FedKind = "statement" | "minutes" | "speech" | "beige-book" | "other";

export interface FedItem {
  id: string;
  date: string; // ISO
  kind: FedKind;
  title: string;
  speaker: string | null; // for speeches
  url: string;
  bias: Bias;
  headline: string; // one-sentence LLM read of the policy signal
  whatChanged: string; // vs the prior comparable (esp. FOMC statements); "" if n/a
  points: string[]; // 2-4 supporting bullets
}

export interface FedWatchData {
  generatedAt: string;
  items: FedItem[]; // newest first
}

export const biasColor = (b: Bias): string => (b === "hawkish" ? "#ef4444" : b === "dovish" ? "#22c55e" : "var(--text-2)");
export const biasLabel = (b: Bias): string => (b === "hawkish" ? "Hawkish" : b === "dovish" ? "Dovish" : "Neutral");
export const kindLabel = (k: FedKind): string =>
  k === "statement" ? "FOMC statement" : k === "minutes" ? "FOMC minutes" : k === "beige-book" ? "Beige Book" : k === "speech" ? "Speech" : "Fed";

// Current stance = the most recent FOMC statement's bias, plus the lean of recent speeches.
export function currentStance(items: FedItem[]): { statement: FedItem | null; speechTally: { hawkish: number; dovish: number; neutral: number } } {
  const statement = items.find((i) => i.kind === "statement") ?? null;
  const speeches = items.filter((i) => i.kind === "speech").slice(0, 12);
  const speechTally = {
    hawkish: speeches.filter((s) => s.bias === "hawkish").length,
    dovish: speeches.filter((s) => s.bias === "dovish").length,
    neutral: speeches.filter((s) => s.bias === "neutral").length,
  };
  return { statement, speechTally };
}
