"use client";
import { useEffect, useState } from "react";
import MarkdownLite from "./MarkdownLite";

// Opt-in AI head-to-head verdict for the picked tickers. Collapsed to a single button until
// the user asks for it (the call is slow + costs a Gemini request), then renders the markdown
// answer + web sources. Resets whenever the comparison set changes.
export default function CompareVerdict({ tickers }: { tickers: { symbol: string; name: string }[] }) {
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<{ title: string; uri: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const key = tickers.map((t) => t.symbol).join(",");

  // a changed set invalidates the prior verdict
  useEffect(() => { setAnswer(null); setError(null); setLoading(false); }, [key]);

  const run = () => {
    if (loading || tickers.length < 2) return;
    setLoading(true); setError(null); setAnswer(null);
    fetch("/api/compare-verdict", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: tickers.map((t) => t.symbol), names: tickers.map((t) => t.name) }),
    })
      .then((r) => r.json())
      .then((d) => {
        setLoading(false);
        if (d.configured === false) setError("AI verdict needs a GEMINI_API_KEY configured.");
        else if (d.answer) { setAnswer(d.answer); setSources(d.sources || []); }
        else setError(d.error || "Couldn't generate the verdict.");
      })
      .catch(() => { setLoading(false); setError("Something went wrong reaching the AI."); });
  };

  return (
    <section className="rounded-xl border border-[#a855f7]/40 bg-[#a855f7]/[0.06] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-[var(--text)]">🤖 AI head-to-head verdict</span>
          <span className="font-mono text-[11px] text-[var(--text-4)]">{tickers.map((t) => t.symbol).join(" · ")}</span>
        </div>
        {!answer && !loading && (
          <button onClick={run} disabled={tickers.length < 2} className="rounded-lg bg-[#a855f7] px-4 py-1.5 text-sm font-medium text-white transition-colors hover:bg-[#9333ea] disabled:opacity-50">
            Generate verdict
          </button>
        )}
      </div>

      {!answer && !loading && !error && (
        <p className="mt-1.5 text-[11px] text-[var(--text-4)]">Reads each company&apos;s fundamentals + the latest web and gives a ranked take — better business vs better value, with a bull &amp; bear on each.</p>
      )}

      {loading && (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-[var(--text-3)]">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-4)] border-t-transparent" />
          Weighing {tickers.length} companies — reading fundamentals &amp; the latest web…
        </div>
      )}
      {error && <p className="mt-2 text-xs text-[#ef4444]">{error}</p>}

      {answer && (
        <div className="mt-3">
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
          <p className="mt-1.5 text-[10px] text-[var(--text-4)]">AI-generated · <button onClick={run} className="underline hover:text-[var(--text-2)]">regenerate</button> · not investment advice.</p>
        </div>
      )}
    </section>
  );
}
