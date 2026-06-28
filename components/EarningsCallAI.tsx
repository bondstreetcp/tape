"use client";
import { useState } from "react";
import MarkdownLite from "./MarkdownLite";

interface Result { available: boolean; title?: string; date?: string | null; url?: string; source?: string; summary?: string | null }

export default function EarningsCallAI({ symbol, name }: { symbol: string; name?: string }) {
  const label = name || symbol;
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    if (loading) return;
    setLoading(true); setError(null); setData(null);
    fetch(`/api/earnings-call/${encodeURIComponent(symbol)}?name=${encodeURIComponent(label)}`)
      .then((r) => r.json())
      .then((d) => {
        setLoading(false);
        if (d.configured === false) setError("Add a GEMINI_API_KEY to enable this.");
        else if (!d.available) setError("Couldn't find a recent transcript to summarize for this name.");
        else if (d.summary) setData(d);
        else setError(d.error || "Couldn't summarize the call.");
      })
      .catch(() => { setLoading(false); setError("Something went wrong reaching the AI."); });
  };

  return (
    <section className="mb-4 rounded-xl border border-[#a855f7]/40 bg-[#a855f7]/[0.06] p-4">
      {!data && !loading && (
        <button onClick={run} className="flex items-center gap-2 text-sm font-medium text-[var(--text-2)] hover:text-[var(--text)]" disabled={!!error && false}>
          <span className="text-base">🎙️</span> Summarize the latest earnings call
          <span className="text-[11px] font-normal text-[var(--text-4)]">— AI reads the full transcript</span>
        </button>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-[13px] text-[var(--text-3)]">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-4)] border-t-transparent" />
          Finding &amp; reading {label}&apos;s latest earnings-call transcript…
        </div>
      )}
      {error && (
        <div className="flex items-center justify-between gap-2 text-xs text-[#ef4444]">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-[var(--text-4)] hover:text-[var(--text)]">✕</button>
        </div>
      )}
      {data && (
        <div>
          <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm font-semibold text-[var(--text-2)]">🎙️ {data.title || "Earnings call"}</span>
            <span className="text-[11px] text-[var(--text-4)]">
              {data.date ? new Date(data.date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : ""}
              {data.source ? ` · ${data.source}` : ""}
            </span>
          </div>
          <div className="rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-body)]">
            <MarkdownLite text={data.summary || ""} />
          </div>
          <p className="mt-1.5 text-[10px] text-[var(--text-4)]">
            AI summary of the transcript{data.url ? <> · <a href={data.url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">read the full call ↗</a></> : null} · verify before relying on it.
          </p>
        </div>
      )}
    </section>
  );
}
