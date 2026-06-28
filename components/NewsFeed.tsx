"use client";
import { useEffect, useState } from "react";
import { LoadingState } from "./Spinner";

interface NewsItem {
  title: string;
  publisher: string;
  link: string;
  time: string | null;
  tickers: string[];
}

function timeAgo(iso: string | null): string {
  if (!iso) return "";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || !Number.isFinite(ms)) return "";
  const m = Math.floor(ms / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function NewsFeed({
  query,
  title = "Recent news",
  count = 10,
}: {
  query: string;
  title?: string;
  count?: number;
}) {
  const [news, setNews] = useState<NewsItem[] | null>(null);

  useEffect(() => {
    let alive = true;
    setNews(null);
    fetch(`/api/news?q=${encodeURIComponent(query)}&count=${count}`)
      .then((r) => r.json())
      .then((d) => alive && setNews(d.news || []))
      .catch(() => alive && setNews([]));
    return () => {
      alive = false;
    };
  }, [query, count]);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-2.5 text-sm font-semibold text-[var(--text-2)]">{title}</div>
      {news === null ? (
        <LoadingState label="Loading headlines…" className="py-12" />
      ) : news.length === 0 ? (
        <div className="p-6 text-center text-sm text-[var(--text-3)]">No recent news.</div>
      ) : (
        <ul className="divide-y divide-[var(--divider)]">
          {[...news].sort((a, b) => (b.time ? Date.parse(b.time) : 0) - (a.time ? Date.parse(a.time) : 0)).map((n, i) => (
            <li key={i}>
              <a href={n.link} target="_blank" rel="noreferrer" className="block px-4 py-3 transition-colors hover:bg-[var(--surface-hover)]">
                <div className="text-sm leading-snug text-[var(--text)]">{n.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[var(--text-3)]">
                  <span className="text-[var(--text-2)]">{n.publisher}</span>
                  {n.time && <span>· {timeAgo(n.time)}</span>}
                  {n.tickers.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {n.tickers.map((t) => (
                        <span key={t} className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 font-mono text-[10px] text-[#93c5fd]">{t}</span>
                      ))}
                    </span>
                  )}
                </div>
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
