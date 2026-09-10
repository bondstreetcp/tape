import type { CallRecord } from "./callsArchive";
import { narrative } from "./llmValidate";
export interface CallChange { topic: string; change: string; beforeQuote: string; afterQuote: string }
export interface CallComparison { before: { period: string; date: string; title: string }; after: { period: string; date: string; title: string }; changes: CallChange[]; generatedAt: string }
export function precedingEarnings(calls: CallRecord[], selected: CallRecord): CallRecord | undefined {
  return calls.filter(c => c.symbol === selected.symbol && c.fiscalPeriod !== selected.fiscalPeriod && c.callDate < selected.callDate && c.eventType !== "conference" && /^\d{4}-Q[1-4]$/.test(c.fiscalPeriod))
    .sort((a,b) => b.callDate.localeCompare(a.callDate))[0];
}
const normalize = (s: string) => s.replace(/\s+/g, " ").trim();
export function verifiedChanges(raw: unknown, before: string, after: string): CallChange[] {
  const list = raw && typeof raw === "object" ? (raw as { changes?: unknown }).changes : null;
  if (!Array.isArray(list)) return [];
  return list.map((v: { topic?: unknown; change?: unknown; beforeQuote?: unknown; afterQuote?: unknown } | null) => ({
    topic: narrative(v?.topic, 100), change: narrative(v?.change, 700),
    beforeQuote: typeof v?.beforeQuote === "string" ? normalize(v.beforeQuote) : "",
    afterQuote: typeof v?.afterQuote === "string" ? normalize(v.afterQuote) : "",
  })).filter(c => c.topic && c.change && c.beforeQuote.length >= 20 && c.beforeQuote.length <= 500 && c.afterQuote.length >= 20 && c.afterQuote.length <= 500 && normalize(before).includes(c.beforeQuote) && normalize(after).includes(c.afterQuote)).slice(0, 5);
}
