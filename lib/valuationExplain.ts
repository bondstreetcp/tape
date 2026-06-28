// "Cheap-vs-history, explained" — a GLM verdict on each deep discount: is the low multiple a
// GENUINE discount (fundamentals stable/improving, just out of favor) or a likely VALUE TRAP
// (the market is correctly pricing deterioration)? Built by scripts/refresh-valuation-explain.ts
// and overlaid on the Discount-to-History screen. Client-safe (types + palette only, no fs).

export type Verdict = "genuine" | "trap" | "mixed";

export interface ValuationVerdict {
  verdict: Verdict;
  reason: string; // one concise sentence grounding the call
}

export type ValuationExplainMap = Record<string, ValuationVerdict>;

export const VERDICT_META: Record<Verdict, { label: string; short: string; color: string }> = {
  genuine: { label: "Genuine discount", short: "Genuine", color: "#22c55e" },
  trap: { label: "Possible value trap", short: "Trap risk", color: "#ef4444" },
  mixed: { label: "Mixed — cheap but with real risks", short: "Mixed", color: "#eab308" },
};
