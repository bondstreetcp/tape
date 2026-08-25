"use client";
import { useEffect, useState } from "react";
import { TOPIC_COLOR, type MarketHeadline } from "@/lib/marketHeadlines";

// Global bottom news bar — a Bloomberg-terminal-style scrolling wire of the market headlines, ⚡ Walter
// Bloomberg flashes first. Fixed to the bottom on every page, dismissible (persisted), pauses on hover,
// refreshes every 5 min from /api/market-headlines. Honors prefers-reduced-motion (no auto-scroll).
export default function NewsTicker() {
  const [items, setItems] = useState<MarketHeadline[]>([]);
  const [hidden, setHidden] = useState(true);

  useEffect(() => {
    let dismissed = false;
    try { dismissed = localStorage.getItem("tape.ticker") === "off"; } catch { /* no localStorage */ }
    if (dismissed) return;
    let alive = true;
    const load = () =>
      fetch("/api/market-headlines")
        .then((r) => r.json())
        .then((j) => { if (alive && Array.isArray(j.headlines) && j.headlines.length) { setItems(j.headlines.slice(0, 30)); setHidden(false); } })
        .catch(() => { /* leave hidden */ });
    load();
    const t = setInterval(load, 300_000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Reserve space so the fixed bar never covers page content.
  useEffect(() => {
    const show = !hidden && items.length > 0;
    document.body.style.paddingBottom = show ? "32px" : "";
    return () => { document.body.style.paddingBottom = ""; };
  }, [hidden, items.length]);

  const dismiss = () => { setHidden(true); try { localStorage.setItem("tape.ticker", "off"); } catch { /* ignore */ } };
  if (hidden || !items.length) return null;

  const row = (h: MarketHeadline, i: number) => (
    <a key={i} href={h.url} target="_blank" rel="noopener noreferrer" className="group inline-flex items-center gap-1.5 px-4" title={`${h.publisher}${h.time ? "" : ""}`}>
      {h.curated
        ? <span className="font-bold text-[var(--accent)]">⚡</span>
        : <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: TOPIC_COLOR[h.topic] }} />}
      <span className="text-[var(--text-2)] group-hover:text-[var(--text)] group-hover:underline">{h.title}</span>
      <span className="text-[var(--text-4)]">· {h.publisher}</span>
    </a>
  );

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 flex h-8 items-stretch border-t border-[var(--border)] bg-[var(--surface)]/95 text-[12px] backdrop-blur">
      <div className="flex shrink-0 items-center gap-1.5 border-r border-[var(--border)] px-2.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--accent)]">
        <span className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-[var(--accent)]" /> Wire
      </div>
      <div className="ticker-mask relative flex-1 overflow-hidden">
        <div className="tape-ticker-track flex h-full items-center whitespace-nowrap">
          <div className="flex items-center">{items.map(row)}</div>
          <div className="flex items-center" aria-hidden>{items.map(row)}</div>
        </div>
      </div>
      <button onClick={dismiss} className="shrink-0 border-l border-[var(--border)] px-2.5 text-[var(--text-4)] hover:text-[var(--text)]" title="Hide the news bar">✕</button>
      <style>{`
        .tape-ticker-track { animation: tape-ticker-scroll 140s linear infinite; will-change: transform; }
        .ticker-mask:hover .tape-ticker-track { animation-play-state: paused; }
        @keyframes tape-ticker-scroll { from { transform: translateX(0); } to { transform: translateX(-50%); } }
        .ticker-mask { -webkit-mask-image: linear-gradient(to right, transparent, #000 2%, #000 98%, transparent); mask-image: linear-gradient(to right, transparent, #000 2%, #000 98%, transparent); }
        @media (prefers-reduced-motion: reduce) { .tape-ticker-track { animation: none; } }
      `}</style>
    </div>
  );
}
