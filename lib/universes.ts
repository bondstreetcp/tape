// Selectable index universes. Each is a distinct constituent list; the app's
// data and routes are scoped by universe id.
export interface UniverseMeta {
  id: string;
  name: string; // full display name
  short: string; // compact label for the switcher
  /** Whether we fetch per-stock intraday data (enables 1D/1W comparison lines). */
  intraday: boolean;
  note?: string;
}

export const UNIVERSES: UniverseMeta[] = [
  { id: "sp500", name: "S&P 500", short: "S&P 500", intraday: true },
  { id: "nasdaq100", name: "Nasdaq 100", short: "Nasdaq 100", intraday: true },
  {
    id: "russell1000",
    name: "Russell 1000",
    short: "Russell 1000",
    intraday: false,
  },
  {
    id: "sp1500",
    name: "Broad 1500 (S&P 1500)",
    short: "Broad 1500",
    intraday: false,
    note: "S&P 500 + 400 + 600 — a broad large/mid/small-cap universe (stands in for the Russell 3000, whose holdings aren't available from free sources).",
  },
];

export const DEFAULT_UNIVERSE = "sp500";
export const UNIVERSE_IDS = UNIVERSES.map((u) => u.id);
export const UNIVERSE_BY_ID: Record<string, UniverseMeta> = Object.fromEntries(
  UNIVERSES.map((u) => [u.id, u]),
);
