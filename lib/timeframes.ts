export type TimeframeKey = "1d" | "1w" | "3m" | "6m" | "ytd" | "1y" | "3y" | "5y";

export const TIMEFRAMES: { key: TimeframeKey; label: string }[] = [
  { key: "1d", label: "1D" },
  { key: "1w", label: "1W" },
  { key: "3m", label: "3M" },
  { key: "6m", label: "6M" },
  { key: "ytd", label: "YTD" },
  { key: "1y", label: "1Y" },
  { key: "3y", label: "3Y" },
  { key: "5y", label: "5Y" },
];

export const TIMEFRAME_KEYS: TimeframeKey[] = TIMEFRAMES.map((t) => t.key);

/** Validate a string (e.g. from a `?tf=` query param) as a TimeframeKey. */
export function parseTimeframe(v: string | null | undefined): TimeframeKey | null {
  return v && (TIMEFRAME_KEYS as string[]).includes(v)
    ? (v as TimeframeKey)
    : null;
}

// Approximate trading-day lookbacks used to compute returns from a daily close series.
export const LOOKBACK_TRADING_DAYS: Record<
  Exclude<TimeframeKey, "ytd" | "1d">,
  number
> = {
  "1w": 5,
  "3m": 63,
  "6m": 126,
  "1y": 252,
  "3y": 756,
  "5y": 1260,
};

// Color-scale clamp (in %) per timeframe — a return at +/- this value is full green/red.
export const COLOR_CLAMP: Record<TimeframeKey, number> = {
  "1d": 3,
  "1w": 6,
  "3m": 15,
  "6m": 25,
  ytd: 40,
  "1y": 40,
  "3y": 90,
  "5y": 180,
};
