"use client";
import { useEffect, useState } from "react";

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
    <div className="rounded-xl border border-[#2a2e39] bg-[#131722]">
      <div className="border-b border-[#2a2e39] px-4 py-2.5 text-sm font-semibold text-[#aab2c5]">{title}</div>
      {news === null ? (
        <div className="p-6 text-center text-sm text-[#8b93a7]">Loading headlines…</div>
      ) : news.length === 0 ? (
        <div className="p-6 text-center text-sm text-[#8b93a7]">No recent news.</div>
      ) : (
        <ul className="divide-y divide-[#1f2430]">
          {news.map((n, i) => (
            <li key={i}>
              <a href={n.link} target="_blank" rel="noreferrer" className="block px-4 py-3 transition-colors hover:bg-[#1a1f2e]">
                <div className="text-sm leading-snug text-[#e6e9f0]">{n.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-[#8b93a7]">
                  <span className="text-[#aab2c5]">{n.publisher}</span>
                  {n.time && <span>· {timeAgo(n.time)}</span>}
                  {n.tickers.length > 0 && (
                    <span className="flex flex-wrap gap-1">
                      {n.tickers.map((t) => (
                        <span key={t} className="rounded bg-[#1a1f2e] px-1.5 py-0.5 font-mono text-[10px] text-[#93c5fd]">{t}</span>
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
