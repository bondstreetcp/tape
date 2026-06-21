"use client";
import { useState } from "react";
import type { Returns } from "@/lib/types";
import MarkdownLite from "./MarkdownLite";

const fmtMove = (r: number | null) => (r == null ? null : `${r >= 0 ? "+" : ""}${r.toFixed(1)}%`);

export default function ExplainMove({ symbol, name, returns }: { symbol: string; name: string; returns: Returns }) {
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<{ title: string; uri: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  const run = () => {
    if (loading) return;
    setLoading(true); setError(null); setAnswer(null);
    const parts = ([["1d", "today"], ["1w", "over the past week"], ["3m", "over the past 3 months"]] as const)
      .map(([k, label]) => { const m = fmtMove(returns?.[k] ?? null); return m ? `${m} ${label}` : null; })
      .filter(Boolean);
    const moves = parts.length ? parts.join(", ") : "roughly flat recently";
    const q =
      `Explain ${name}'s (${symbol}) recent share-price move — it's ${moves}. ` +
      `What's driving it: earnings or guidance, analyst rating/price-target changes, product/regulatory/legal news, M&A, or just broad sector/market moves? ` +
      `Cite the specific recent developments you find. If there's no clear company-specific catalyst and it's mostly tracking the market or its sector, say that plainly.`;
    fetch(`/api/ask/${encodeURIComponent(symbol)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q, name, history: [] }),
    })
      .then((r) => r.json())
      .then((d) => {
        setLoading(false);
        if (d.configured === false) setError("Add a GEMINI_API_KEY to enable this.");
        else if (d.answer) { setAnswer(d.answer); setSources(d.sources || []); }
        else setError(d.error || "Couldn't explain the move.");
      })
      .catch(() => { setLoading(false); setError("Something went wrong reaching the AI."); });
  };

  return (
    <section className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      {!answer && !loading && !error && (
        <button onClick={run} className="flex items-center gap-2 text-sm font-medium text-[var(--text-2)] hover:text-[var(--text)]">
          <span className="text-base">🔍</span> Explain the recent move
          <span className="text-[11px] font-normal text-[var(--text-4)]">— AI reads the latest news &amp; ties it to the price</span>
        </button>
      )}
      {loading && (
        <div className="flex items-center gap-2 text-[13px] text-[var(--text-3)]">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-4)] border-t-transparent" />
          Reading the latest on {name} and tying it to the price action…
        </div>
      )}
      {error && (
        <div className="flex items-center justify-between gap-2 text-xs text-[#ef4444]">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="text-[var(--text-4)] hover:text-[var(--text)]">✕</button>
        </div>
      )}
      {answer && (
        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="text-sm font-semibold text-[var(--text-2)]">Why {symbol} is moving</span>
            <button onClick={run} className="text-[11px] text-[var(--text-4)] hover:text-[var(--text)]">↻ refresh</button>
          </div>
          <div className="rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-body)]">
            <MarkdownLite text={answer} />
          </div>
          {sources.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sources.map((s, i) => (
                <a key={i} href={s.uri} target="_blank" rel="noreferrer" title={s.title} className="max-w-[220px] truncate rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[#60a5fa] hover:border-[var(--border-strong)]">{s.title} ↗</a>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[10px] text-[var(--text-4)]">AI-generated from current news &amp; web search · not investment advice.</p>
        </div>
      )}
    </section>
  );
}
