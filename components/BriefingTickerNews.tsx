"use client";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

interface Story { source: string; cadence: string; date: string | null; headline: string; snippet: string }

// Stories from today's Reuters briefing that name this company. Renders nothing when the
// briefing doesn't cover the name, so it only appears when there's something to show.
export default function BriefingTickerNews({ symbol, name }: { symbol: string; name: string }) {
  const [stories, setStories] = useState<Story[] | null>(null);
  const pathname = usePathname();
  const universe = pathname?.split("/")[2] || "sp500";

  useEffect(() => {
    let alive = true;
    setStories(null);
    fetch(`/api/briefing-news/${encodeURIComponent(symbol)}?name=${encodeURIComponent(name)}`)
      .then((r) => r.json())
      .then((d) => alive && setStories(d.stories || []))
      .catch(() => alive && setStories([]));
    return () => { alive = false; };
  }, [symbol, name]);

  if (!stories || stories.length === 0) return null;

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-2 border-b border-[var(--border)] px-4 py-2.5">
        <span className="text-sm font-semibold text-[var(--text-2)]">In today&apos;s briefing</span>
        <a href={`/u/${universe}/briefing`} className="shrink-0 text-[11px] text-[var(--accent)] hover:underline">Open briefing →</a>
      </div>
      <ul className="divide-y divide-[var(--divider)]">
        {stories.map((s, i) => (
          <li key={i} className="px-4 py-3">
            <div className="text-sm font-semibold leading-snug text-[var(--text)]">{s.headline}</div>
            {s.snippet && <p className="mt-1 text-[13px] leading-relaxed text-[var(--text-body)]">{s.snippet}</p>}
            <div className="mt-1.5 text-[11px] text-[var(--text-4)]">{s.source}{s.date ? ` · ${s.date}` : ""} · Reuters</div>
          </li>
        ))}
      </ul>
    </div>
  );
}
