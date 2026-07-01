/**
 * Policy & Contracts — an LLM signal feed from two free federal sources: the Federal Register (new
 * RULES: tariffs, EPA, drug-pricing, FAA airworthiness, FTC) mapped to the public companies they hit,
 * and USAspending (large government CONTRACT awards) mapped to the public contractor that won them.
 * Built by scripts/refresh-policy.ts → data/policy.json. A policy signal, not advice.
 *
 * CLIENT-SAFE: types + pure helpers (no fs).
 */

export type PolicyKind = "rule" | "contract";
export type Impact = "positive" | "negative" | "mixed";

export interface AffectedTicker { ticker: string; impact: Impact }

export interface PolicyItem {
  id: string;
  date: string; // ISO
  kind: PolicyKind;
  title: string;
  agency: string; // issuing agency (rules) or awarding agency (contracts)
  amount: number | null; // contract $ (null for rules)
  recipient: string | null; // contract winner (null for rules)
  tickers: AffectedTicker[]; // affected/benefiting public companies
  summary: string; // one-line LLM read
  url: string;
}

export interface PolicyData {
  generatedAt: string;
  scanned: number;
  items: PolicyItem[]; // newest first
}

export const impactColor = (i: Impact): string => (i === "positive" ? "#22c55e" : i === "negative" ? "#ef4444" : "#f59e0b");
export const kindColor = (k: PolicyKind): string => (k === "contract" ? "#22c55e" : "#60a5fa");
export const kindLabel = (k: PolicyKind): string => (k === "contract" ? "Contract award" : "Federal rule");
export const fmtAmt = (v: number | null): string => {
  if (v == null) return "";
  if (v >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (v >= 1e6) return `$${(v / 1e6).toFixed(0)}M`;
  return `$${(v / 1e3).toFixed(0)}K`;
};
