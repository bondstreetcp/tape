// The Confluence Engine — a nightly board that fuses the INDEPENDENT bullish signals the app
// already produces (cheap vs own history, super-investor 13F adds, Congress buys, analyst
// upgrades, call-heavy options flow, catalysts) and surfaces the names where several of them
// AGREE. One signal is noise; three unrelated signals pointing the same way is a setup worth a
// look. GLM writes a thesis / risk / what-to-watch for the top names. Decision-support, not advice.

export type SignalKind = "value" | "smartmoney" | "insider" | "congress" | "revisions" | "analyst" | "options" | "squeeze" | "catalyst";

export interface ConfluenceSignal {
  kind: SignalKind;
  label: string; // short chip text, e.g. "Cheap vs 10yr"
  detail: string; // fuller line for the tooltip + the LLM context
  weight: number;
}

export interface ConfluenceRead {
  thesis: string; // the bull case the confluence implies
  risk: string; // the bear case / what could break it
  watch: string; // what would confirm or refute the setup
}

export interface ConfluenceName {
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
  kinds: SignalKind[]; // distinct signal kinds present (the breadth of the confluence)
  signals: ConfluenceSignal[];
  read: ConfluenceRead | null; // GLM-authored, top names only
}

export interface ConfluenceData {
  generatedAt: string;
  universe: string; // the context universe the board was built over
  asOf: string | null;
  names: ConfluenceName[]; // ranked, highest confluence first
  counts: Record<SignalKind, number>; // how many names carry each signal (for the legend)
}

export const SIGNAL_ORDER: SignalKind[] = ["value", "smartmoney", "insider", "congress", "revisions", "analyst", "options", "squeeze", "catalyst"];

export const SIGNAL_META: Record<SignalKind, { label: string; color: string; blurb: string }> = {
  value: { label: "Value", color: "#22c55e", blurb: "Trading cheap vs its own 10-year valuation" },
  smartmoney: { label: "Smart money", color: "#a78bfa", blurb: "A super-investor added or initiated it last quarter (13F)" },
  insider: { label: "Insider buying", color: "#10b981", blurb: "Insiders bought on the open market (SEC Form 4)" },
  congress: { label: "Congress", color: "#60a5fa", blurb: "A member of Congress bought it recently (net buyer)" },
  revisions: { label: "Estimates rising", color: "#2dd4bf", blurb: "Analysts are raising EPS estimates (revision momentum)" },
  analyst: { label: "Analyst", color: "#38bdf8", blurb: "A recent sell-side upgrade" },
  options: { label: "Call flow", color: "#f59e0b", blurb: "Unusually call-heavy options flow" },
  squeeze: { label: "Squeeze fuel", color: "#fb7185", blurb: "Heavily shorted — squeeze potential if the bull case plays out" },
  catalyst: { label: "Catalyst", color: "#ec4899", blurb: "A near-term catalyst on file" },
};
