// Warning Signs — the BEARISH twin of the Confluence Engine. Where the Confluence board stacks
// independent BULLISH signals, this stacks the independent NEGATIVE ones: a name trading rich vs its own
// history, the Street cutting EPS, super-investors exiting, a sell-side downgrade, management cutting its
// own guide, and put-heavy options flow. One is noise; a stack of unrelated bear signals on the same
// name — especially one still priced for perfection — is a value-trap / short-candidate flag worth a
// look. GLM writes the bear case / what would invalidate it / what to watch. Decision-support, not advice.

export type WarningKind = "expensive" | "estcuts" | "distribution" | "shortcampaign" | "downgrade" | "guidancecut" | "putflow";

// The signal-log join shown on the board cards ("±x% since flagged") — shared with Confluence.
export type { FlaggedInfo } from "./signalLog";

export interface WarningSignal {
  kind: WarningKind;
  label: string;
  detail: string;
  weight: number;
}

export interface WarningRead {
  thesis: string; // the BEAR case the stacked signals imply
  risk: string; // what would INVALIDATE it (the bull case / why it might be fine)
  watch: string; // the concrete thing that would confirm or refute the warning
}

export interface WarningName {
  symbol: string;
  name: string;
  sector: string | null;
  marketCap: number | null;
  price: number | null;
  ret1w: number | null;
  ret3m: number | null;
  retYtd: number | null;
  pctFromHigh: number | null;
  score: number;
  kinds: WarningKind[];
  signals: WarningSignal[];
  read: WarningRead | null;
}

export interface WarningsData {
  generatedAt: string;
  universe: string;
  asOf: string | null;
  names: WarningName[];
  counts: Record<WarningKind, number>;
}

export const WARNING_ORDER: WarningKind[] = ["expensive", "estcuts", "distribution", "shortcampaign", "guidancecut", "downgrade", "putflow"];

export const WARNING_META: Record<WarningKind, { label: string; color: string; blurb: string }> = {
  expensive: { label: "Expensive", color: "#ef4444", blurb: "Trading rich vs its own 10-year valuation — priced for perfection" },
  estcuts: { label: "Estimates falling", color: "#fb7185", blurb: "Analysts are cutting EPS estimates (negative revision momentum)" },
  distribution: { label: "Smart-money exit", color: "#f59e0b", blurb: "Super-investors sold out or sharply trimmed last quarter (13F)" },
  shortcampaign: { label: "Short report", color: "#ea580c", blurb: "A short-seller published a public thesis against the company" },
  guidancecut: { label: "Guidance cut", color: "#f472b6", blurb: "Management cut its own forward outlook" },
  downgrade: { label: "Downgrade", color: "#fbbf24", blurb: "A recent sell-side downgrade" },
  putflow: { label: "Put-heavy flow", color: "#a78bfa", blurb: "Unusually put-heavy options flow (hedging / bearish positioning)" },
};
