"use client";
import { useState } from "react";

const SUGGESTIONS = [
  "What does this company do?",
  "How does its valuation compare to its growth?",
  "What stands out in its recent results?",
  "What are the key risks?",
];

interface Source { title: string; uri: string }
interface State { loading: boolean; answer?: string | null; error?: string; configured?: boolean; sources?: Source[] }

export default function AskAI({ symbol, name }: { symbol: string; name?: string }) {
  const [q, setQ] = useState("");
  const [s, setS] = useState<State>({ loading: false });
  const label = name || symbol;

  const ask = (question: string) => {
    if (!question.trim()) return;
    setQ(question);
    setS({ loading: true });
    const u = new URLSearchParams({ q: question, name: label });
    fetch(`/api/ask/${encodeURIComponent(symbol)}?${u.toString().replace(/\+/g, "%20")}`)
      .then((r) => r.json())
      .then((d) => setS({ loading: false, answer: d.answer, error: d.error, configured: d.configured, sources: d.sources }))
      .catch((e) => setS({ loading: false, error: String(e), configured: true }));
  };

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Ask AI about {label}</h3>
        <span className="inline-flex items-center gap-1 rounded bg-[#2563eb]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#93c5fd]">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          Gemini · web search
        </span>
      </div>
      <p className="mb-2 text-[11px] leading-relaxed text-[var(--text-4)]">
        Searches the live web for current news &amp; events plus this company&apos;s financials — like Google Finance&apos;s Ask Gemini.
      </p>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Ask anything about ${label}…`}
          className="min-w-[240px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-4)] focus:border-[var(--border-strong)]"
        />
        <button type="submit" disabled={s.loading} className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50">
          {s.loading ? "Searching…" : "Ask"}
        </button>
      </form>

      {s.loading && (
        <div className="mt-3 flex items-center gap-2 rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-3)]">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-4)] border-t-transparent" />
          Searching the web for the latest on {label}…
        </div>
      )}

      {!s.loading && s.answer == null && !s.error && s.configured !== false && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((x) => (
            <button key={x} onClick={() => ask(x)} className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-3)] hover:border-[var(--border-strong)] hover:text-[var(--text)]">
              {x}
            </button>
          ))}
        </div>
      )}
      {s.configured === false && (
        <div className="mt-2 text-xs leading-relaxed text-[var(--text-3)]">
          Add a free <span className="font-mono text-[var(--text-2)]">GEMINI_API_KEY</span> environment variable to enable AI Q&amp;A — get one at{" "}
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">aistudio.google.com/app/apikey</a>.
        </div>
      )}
      {s.answer && (
        <>
          <div className="mt-3 whitespace-pre-wrap rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] leading-relaxed text-[var(--text-body)]">{s.answer}</div>
          {s.sources && s.sources.length > 0 && (
            <div className="mt-2">
              <div className="mb-1 text-[10px] font-medium uppercase tracking-wide text-[var(--text-4)]">Web sources</div>
              <div className="flex flex-wrap gap-1.5">
                {s.sources.map((src, i) => (
                  <a key={i} href={src.uri} target="_blank" rel="noreferrer" title={src.title} className="max-w-[220px] truncate rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[#60a5fa] hover:border-[var(--border-strong)]">
                    {src.title} ↗
                  </a>
                ))}
              </div>
            </div>
          )}
          <p className="mt-1.5 text-[10px] text-[var(--text-4)]">AI-generated from this app&apos;s data plus live web search. Not investment advice — verify before relying on it.</p>
        </>
      )}
      {s.error && s.configured !== false && <div className="mt-2 text-xs text-[#ef4444]">Couldn&apos;t get an answer: {s.error}</div>}
    </section>
  );
}
