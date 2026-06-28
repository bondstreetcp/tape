"use client";
import { useState } from "react";
import type { StockRow } from "@/lib/types";
import MarkdownLite from "./MarkdownLite";

export default function WatchlistDigest({ rows }: { rows: StockRow[] }) {
  const [loading, setLoading] = useState(false);
  const [digest, setDigest] = useState<string | null>(null);
  const [sources, setSources] = useState<{ title: string; uri: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    if (loading || !rows.length) return;
    setLoading(true); setError(null); setDigest(null);
    const items = rows.slice(0, 20).map((s) => ({
      symbol: s.symbol,
      name: s.name,
      chg1d: s.returns?.["1d"] ?? null,
      chgWk: s.returns?.["1w"] ?? null,
      earnings: s.earningsDate ?? null,
    }));
    fetch("/api/watchlist-digest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ items }),
    })
      .then((r) => r.json())
      .then((d) => {
        setLoading(false);
        if (d.configured === false) setError("Add a GEMINI_API_KEY to enable the AI digest.");
        else if (d.digest) { setDigest(d.digest); setSources(d.sources || []); }
        else setError(d.error || "Couldn't build the digest.");
      })
      .catch(() => { setLoading(false); setError("Something went wrong reaching the AI."); });
  };

  return (
    <section className="mb-4 rounded-xl border border-[#a855f7]/40 bg-[#a855f7]/[0.06] p-4">
      {!digest && !loading && (
        <button onClick={run} className="flex items-center gap-2 text-sm font-medium text-[var(--text-2)] hover:text-[var(--text)]">
          <span className="text-base">📋</span> What happened to my names today
          <span className="text-[11px] font-normal text-[var(--text-4)]">— AI digest of your watchlist, news-grounded</span>
        </button>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-[13px] text-[var(--text-3)]">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-4)] border-t-transparent" />
          Reading the moves &amp; latest news across your {Math.min(rows.length, 20)} names…
        </div>
      )}
      {error && (
        <div className="flex items-center justify-between gap-2 text-xs text-[#ef4444]">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-[var(--text-4)] hover:text-[var(--text)]">✕</button>
        </div>
      )}
      {digest && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--text-2)]">📋 Watchlist digest</span>
            <button onClick={run} className="text-[11px] text-[var(--text-4)] hover:text-[var(--text)]">↻ refresh</button>
          </div>
          <div className="rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-body)]">
            <MarkdownLite text={digest} />
          </div>
          {sources.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sources.map((s, i) => (
                <a key={i} href={s.uri} target="_blank" rel="noreferrer" title={s.title} className="max-w-[220px] truncate rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--accent)] hover:border-[var(--border-strong)]">{s.title} ↗</a>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[10px] text-[var(--text-4)]">AI-generated from your watchlist moves + current news · not investment advice.</p>
        </div>
      )}
    </section>
  );
}
