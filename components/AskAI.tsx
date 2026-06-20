"use client";
import { useState } from "react";

const SUGGESTIONS = [
  "What does this company do?",
  "How does its valuation compare to its growth?",
  "What stands out in its recent results?",
  "What are the key risks?",
];

interface Source { title: string; uri: string }
interface Msg { q: string; a: string; sources?: Source[] }

export default function AskAI({ symbol, name }: { symbol: string; name?: string }) {
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [pending, setPending] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [configured, setConfigured] = useState(true);
  const label = name || symbol;

  const ask = (question: string) => {
    const q = question.trim();
    if (!q || loading) return;
    setInput(""); setError(null); setPending(q); setLoading(true);
    const history = messages.map((m) => ({ q: m.q, a: m.a }));
    fetch(`/api/ask/${encodeURIComponent(symbol)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ q, name: label, history }),
    })
      .then((r) => r.json())
      .then((d) => {
        setLoading(false); setPending(null);
        if (d.configured === false) { setConfigured(false); return; }
        if (d.answer) setMessages((m) => [...m, { q, a: d.answer, sources: d.sources }]);
        else setError(d.error || "Couldn't get an answer.");
      })
      .catch((e) => { setLoading(false); setPending(null); setError(String(e)); });
  };

  const started = messages.length > 0 || pending != null;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-1 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Ask AI about {label}</h3>
        <span className="inline-flex items-center gap-1 rounded bg-[#2563eb]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#93c5fd]">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
          Gemini · web search
        </span>
        {messages.length > 0 && (
          <button onClick={() => { setMessages([]); setError(null); }} className="ml-auto text-[11px] text-[var(--text-4)] hover:text-[var(--text)]">Clear</button>
        )}
      </div>
      {!started && (
        <p className="mb-2 text-[11px] leading-relaxed text-[var(--text-4)]">
          Searches the live web for current news &amp; events plus this company&apos;s financials — and you can keep asking follow-up questions.
        </p>
      )}

      {/* conversation thread */}
      {messages.map((m, i) => (
        <div key={i} className="mb-3">
          <div className="mb-1 flex justify-end">
            <span className="max-w-[85%] rounded-lg rounded-br-sm bg-[#2563eb]/15 px-3 py-1.5 text-[13px] text-[var(--text)]">{m.q}</span>
          </div>
          <div className="whitespace-pre-wrap rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] leading-relaxed text-[var(--text-body)]">{m.a}</div>
          {m.sources && m.sources.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {m.sources.map((src, j) => (
                <a key={j} href={src.uri} target="_blank" rel="noreferrer" title={src.title} className="max-w-[220px] truncate rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[#60a5fa] hover:border-[var(--border-strong)]">
                  {src.title} ↗
                </a>
              ))}
            </div>
          )}
        </div>
      ))}
      {pending && (
        <div className="mb-3">
          <div className="mb-1 flex justify-end">
            <span className="max-w-[85%] rounded-lg rounded-br-sm bg-[#2563eb]/15 px-3 py-1.5 text-[13px] text-[var(--text)]">{pending}</span>
          </div>
          <div className="flex items-center gap-2 rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-3)]">
            <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-4)] border-t-transparent" />
            Searching the web for the latest on {label}…
          </div>
        </div>
      )}

      <form onSubmit={(e) => { e.preventDefault(); ask(input); }} className="flex flex-wrap items-center gap-2">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={started ? "Ask a follow-up…" : `Ask anything about ${label}…`}
          className="min-w-[240px] flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] outline-none placeholder:text-[var(--text-4)] focus:border-[var(--border-strong)]"
        />
        <button type="submit" disabled={loading} className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50">
          {loading ? "Searching…" : started ? "Send" : "Ask"}
        </button>
      </form>

      {!started && configured && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((x) => (
            <button key={x} onClick={() => ask(x)} className="rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--text-3)] hover:border-[var(--border-strong)] hover:text-[var(--text)]">
              {x}
            </button>
          ))}
        </div>
      )}
      {!configured && (
        <div className="mt-2 text-xs leading-relaxed text-[var(--text-3)]">
          Add a free <span className="font-mono text-[var(--text-2)]">GEMINI_API_KEY</span> environment variable to enable AI Q&amp;A — get one at{" "}
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">aistudio.google.com/app/apikey</a>.
        </div>
      )}
      {error && <div className="mt-2 text-xs text-[#ef4444]">{error}</div>}
      {started && <p className="mt-1.5 text-[10px] text-[var(--text-4)]">AI-generated from this app&apos;s data plus live web search. Not investment advice — verify before relying on it.</p>}
    </section>
  );
}
