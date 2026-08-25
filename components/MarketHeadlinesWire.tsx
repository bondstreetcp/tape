"use client";
import { useEffect, useState } from "react";
import { TOPIC_COLOR, type MarketHeadline } from "@/lib/marketHeadlines";

// The market-headlines wire — macro / Fed / trade / energy / geopolitics flashes. Renders the SSR seed
// instantly, then refreshes to ~5-min-live from /api/market-headlines on mount. Shared by the Macro tab
// and the Daily Desk. Relative timestamps are gated on `mounted` so server + first client render match.
export default function MarketHeadlinesWire({ initial = [] }: { initial?: MarketHeadline[] }) {
  const [headlines, setHeadlines] = useState<MarketHeadline[]>(initial);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    let alive = true;
    fetch("/api/market-headlines")
      .then((r) => r.json())
      .then((j) => { if (alive && Array.isArray(j.headlines) && j.headlines.length) setHeadlines(j.headlines); })
      .catch(() => { /* keep the SSR seed */ });
    return () => { alive = false; };
  }, []);

  const ago = (iso: string | null) => {
    if (!mounted || !iso) return "";
    const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
    if (!Number.isFinite(m) || m < 0) return "";
    return m < 60 ? `${m}m` : m < 1440 ? `${Math.round(m / 60)}h` : `${Math.round(m / 1440)}d`;
  };

  if (!headlines.length) {
    return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-[var(--text-3)]">No market headlines just now — the wire refreshes every few minutes.</div>;
  }
  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      {headlines.map((h, i) => (
        <a
          key={i}
          href={h.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-start justify-between gap-3 border-b border-[var(--divider)] px-4 py-2 text-sm last:border-0 hover:bg-[var(--surface-hover)]"
        >
          <span className="flex min-w-0 items-start gap-2">
            <span className="mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-semibold" style={{ background: `${TOPIC_COLOR[h.topic]}22`, color: TOPIC_COLOR[h.topic] }}>{h.topic}</span>
            <span className="min-w-0 text-[var(--text)]">{h.title} <span className="text-[var(--text-4)]">· {h.publisher}</span></span>
          </span>
          {ago(h.time) && <span className="shrink-0 tabular-nums text-[11px] text-[var(--text-4)]">{ago(h.time)}</span>}
        </a>
      ))}
    </div>
  );
}
