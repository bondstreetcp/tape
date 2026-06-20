"use client";
import { useState } from "react";

const SUGGESTIONS = [
  "What does this company do?",
  "How does its valuation compare to its growth?",
  "What stands out in its recent results?",
  "What are the key risks?",
];

interface State { loading: boolean; answer?: string | null; error?: string; configured?: boolean }

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
      .then((d) => setS({ loading: false, answer: d.answer, error: d.error, configured: d.configured }))
      .catch((e) => setS({ loading: false, error: String(e), configured: true }));
  };

  return (
    <section className="rounded-xl border border-[#2a2e39] bg-[#131722] p-4">
      <div className="mb-2 flex items-center gap-2">
        <h3 className="text-sm font-semibold text-[#aab2c5]">Ask AI about {label}</h3>
        <span className="rounded bg-[#2563eb]/15 px-1.5 py-0.5 text-[10px] font-medium text-[#93c5fd]">Gemini</span>
      </div>
      <form onSubmit={(e) => { e.preventDefault(); ask(q); }} className="flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder={`Ask anything about ${label}…`}
          className="min-w-[240px] flex-1 rounded-lg border border-[#2a2e39] bg-[#0d1117] px-3 py-2 text-sm text-[#e6e9f0] outline-none placeholder:text-[#5b6478] focus:border-[#3a4256]"
        />
        <button type="submit" disabled={s.loading} className="rounded-lg bg-[#2563eb] px-4 py-2 text-sm font-medium text-white hover:bg-[#1d4ed8] disabled:opacity-50">
          {s.loading ? "Thinking…" : "Ask"}
        </button>
      </form>

      {!s.loading && s.answer == null && !s.error && s.configured !== false && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {SUGGESTIONS.map((x) => (
            <button key={x} onClick={() => ask(x)} className="rounded-full border border-[#2a2e39] bg-[#0d1117] px-2.5 py-1 text-[11px] text-[#8b93a7] hover:border-[#3a4256] hover:text-[#e6e9f0]">
              {x}
            </button>
          ))}
        </div>
      )}
      {s.configured === false && (
        <div className="mt-2 text-xs leading-relaxed text-[#8b93a7]">
          Add a free <span className="font-mono text-[#aab2c5]">GEMINI_API_KEY</span> environment variable to enable AI Q&amp;A — get one at{" "}
          <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">aistudio.google.com/app/apikey</a>.
        </div>
      )}
      {s.answer && (
        <>
          <div className="mt-3 whitespace-pre-wrap rounded-lg border border-[#1f2430] bg-[#0d1117] p-3 text-[13px] leading-relaxed text-[#c2c8d4]">{s.answer}</div>
          <p className="mt-1.5 text-[10px] text-[#5b6478]">AI-generated from this app&apos;s data (profile, financials, recent news). Not investment advice — verify before relying on it.</p>
        </>
      )}
      {s.error && s.configured !== false && <div className="mt-2 text-xs text-[#ef4444]">Couldn&apos;t get an answer: {s.error}</div>}
    </section>
  );
}
