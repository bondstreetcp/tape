"use client";
import { useWatchlist } from "@/lib/watchlist";

export default function WatchStar({
  symbol,
  size = 18,
  withLabel,
  compact,
}: {
  symbol: string;
  size?: number;
  withLabel?: boolean;
  /** icon-only, borderless — for table/board rows, where the pill button is too heavy. Dim until
   *  hovered or active so a starred name reads at a glance without the column shouting. */
  compact?: boolean;
}) {
  const { has, toggle } = useWatchlist();
  const on = has(symbol);
  if (compact) {
    return (
      <button
        onClick={(e) => { e.stopPropagation(); toggle(symbol); }}
        title={on ? "Remove from watchlist" : "Add to watchlist"}
        aria-label={on ? `Unwatch ${symbol}` : `Watch ${symbol}`}
        className={"inline-flex shrink-0 items-center align-middle transition-colors " + (on ? "text-[#fbbf24]" : "text-[var(--text-4)] opacity-60 hover:text-[#fbbf24] hover:opacity-100")}
      >
        <svg width={size === 18 ? 13 : size} height={size === 18 ? 13 : size} viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }
  return (
    <button
      onClick={() => toggle(symbol)}
      title={on ? "Remove from watchlist" : "Add to watchlist"}
      className={
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors " +
        (on
          ? "border-[#fbbf24]/50 bg-[#fbbf24]/10 text-[#fbbf24]"
          : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]")
      }
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" strokeLinejoin="round" />
      </svg>
      {withLabel && (on ? "In watchlist" : "Watch")}
    </button>
  );
}
