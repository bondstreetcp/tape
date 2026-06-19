"use client";
import { useWatchlist } from "@/lib/watchlist";

export default function WatchStar({
  symbol,
  size = 18,
  withLabel,
}: {
  symbol: string;
  size?: number;
  withLabel?: boolean;
}) {
  const { has, toggle } = useWatchlist();
  const on = has(symbol);
  return (
    <button
      onClick={() => toggle(symbol)}
      title={on ? "Remove from watchlist" : "Add to watchlist"}
      className={
        "inline-flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors " +
        (on
          ? "border-[#fbbf24]/50 bg-[#fbbf24]/10 text-[#fbbf24]"
          : "border-[#2a2e39] bg-[#131722] text-[#8b93a7] hover:text-[#e6e9f0]")
      }
    >
      <svg width={size} height={size} viewBox="0 0 24 24" fill={on ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" strokeLinejoin="round" />
      </svg>
      {withLabel && (on ? "In watchlist" : "Watch")}
    </button>
  );
}
