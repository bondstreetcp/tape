"use client";
import { usePathname, useRouter } from "next/navigation";
import { UNIVERSES } from "@/lib/universes";

/**
 * Switches the active index universe. Stays on the same sector when `etf` is
 * provided; otherwise keeps you on the same section (screener / watchlist /
 * market / macro / compare) for the new universe, falling back to its home.
 */
export default function UniverseSwitcher({
  current,
  etf,
}: {
  current: string;
  etf?: string | null;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const href = (id: string) => {
    const sub = pathname.replace(/^\/u\/[^/]+/, ""); // full path after /u/<universe>
    // a specific stock may not exist in another universe — fall back to its sector,
    // but otherwise keep the same view (sector, sub-industry, screener, compare…).
    // The timeframe persists separately via usePersistedTimeframe (localStorage).
    if (etf && sub.startsWith("/stock/")) return `/u/${id}/sector/${etf.toLowerCase()}`;
    return `/u/${id}${sub}`;
  };
  return (
    <label className="inline-flex items-center gap-2">
      <span className="text-xs uppercase tracking-wide text-[#8b93a7]">
        Universe
      </span>
      <select
        value={current}
        onChange={(e) => router.push(href(e.target.value))}
        className="cursor-pointer rounded-lg border border-[#2a2e39] bg-[#131722] px-3 py-2 text-sm font-semibold text-[#e6e9f0] outline-none transition-colors hover:border-[#3a4256]"
      >
        {UNIVERSES.map((u) => (
          <option key={u.id} value={u.id} className="bg-[#131722]">
            {u.name}
          </option>
        ))}
      </select>
    </label>
  );
}
