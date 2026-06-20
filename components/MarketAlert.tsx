"use client";
import { useEffect, useState } from "react";

interface Item { title: string; publisher: string; link: string; time: string | null }

// High-impact, market-moving themes worth a red alert (the news feed is already
// clickbait-filtered, so matches here are reputable wire/press headlines).
const ALERT = /\b(fed|fomc|federal reserve|rate (cut|hike|decision)|interest rate|inflation|\bcpi\b|\bppi\b|jobs report|payrolls|unemployment|recession|tariffs?|trade war|sanctions?|\bdefault\b|debt ceiling|shutdown|crash|sell-?off|plunge|plummet|circuit breaker|\bwar\b|invasion|downgrade|credit rating|emergency|bailout|bankruptc)\b/i;

export default function MarketAlert() {
  const [alerts, setAlerts] = useState<Item[]>([]);
  const [idx, setIdx] = useState(0);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    let on = true;
    fetch("/api/news?q=market")
      .then((r) => r.json())
      .then((d) => {
        const items: Item[] = (d.news || []).filter((n: Item) => n.title && ALERT.test(n.title)).slice(0, 6);
        if (on) setAlerts(items);
      })
      .catch(() => {});
    return () => { on = false; };
  }, []);

  useEffect(() => {
    if (alerts.length < 2) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % alerts.length), 6500);
    return () => clearInterval(t);
  }, [alerts.length]);

  if (dismissed || alerts.length === 0) return null;
  const a = alerts[idx % alerts.length];
  return (
    <div className="mb-4 flex items-center gap-3 rounded-xl border border-[#ef4444]/40 bg-[#ef4444]/10 px-3 py-2.5">
      <span className="flex shrink-0 items-center gap-1.5 rounded bg-[#ef4444] px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-white">
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-white" /> Alert
      </span>
      <a href={a.link} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate text-sm font-medium text-[var(--text)] hover:underline" title={a.title}>
        {a.title}
      </a>
      <span className="hidden shrink-0 text-[11px] text-[var(--text-3)] sm:inline">{a.publisher}</span>
      {alerts.length > 1 && <span className="shrink-0 tabular-nums text-[11px] text-[var(--text-4)]">{(idx % alerts.length) + 1}/{alerts.length}</span>}
      <button onClick={() => setDismissed(true)} className="shrink-0 px-1 text-[var(--text-3)] hover:text-[var(--text)]" title="Dismiss" aria-label="Dismiss alert">✕</button>
    </div>
  );
}
