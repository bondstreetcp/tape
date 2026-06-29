"use client";
import { useState } from "react";

interface Exchange { topic: string; analyst: string; question: string; answer: string; directness: "direct" | "partial" | "evasive" }
interface Analysis {
  configured: boolean;
  available?: boolean;
  title?: string;
  date?: string | null;
  url?: string;
  priorDate?: string | null;
  tone?: string;
  topics?: string[];
  guidance?: string;
  exchanges?: Exchange[];
  whatChanged?: string[];
}

const DIR_META: Record<string, { label: string; color: string }> = {
  direct: { label: "Direct", color: "#22c55e" },
  partial: { label: "Partial", color: "#eab308" },
  evasive: { label: "Evasive", color: "#ef4444" },
};

export default function CallAnalysis({ symbol, name }: { symbol: string; name?: string }) {
  const [data, setData] = useState<Analysis | "idle" | "loading">("idle");
  const run = () => {
    setData("loading");
    fetch(`/api/transcript-analysis/${encodeURIComponent(symbol)}?name=${encodeURIComponent(name || symbol)}`)
      .then((r) => r.json())
      .then((d: Analysis) => setData(d))
      .catch(() => setData({ configured: true, available: false }));
  };
  const d = typeof data === "object" ? data : null;

  return (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-4 py-2.5">
        <div className="min-w-0">
          <span className="text-sm font-semibold text-[var(--text-2)]">Call analysis</span>
          <span className="ml-2 text-[11px] text-[var(--text-4)]">AI Q&amp;A breakdown &amp; what changed vs. last quarter</span>
        </div>
        {data === "idle" && (
          <button onClick={run} className="shrink-0 rounded-lg bg-[var(--accent-strong)] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:opacity-90">Analyze the latest call →</button>
        )}
      </div>

      {data === "loading" && <div className="flex items-center gap-2 px-4 py-4 text-xs text-[var(--text-3)]"><span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)]" /> Reading the transcript &amp; the prior call…</div>}

      {d && d.configured === false && <div className="px-4 py-4 text-xs text-[var(--text-3)]">AI isn&apos;t configured.</div>}
      {d && d.configured && d.available === false && <div className="px-4 py-4 text-xs text-[var(--text-3)]">No transcript found for the latest call yet.</div>}

      {d && d.available && (
        <div className="space-y-3 px-4 py-3 text-[12px] leading-snug">
          <div className="flex flex-wrap items-baseline gap-x-2 text-[11px] text-[var(--text-4)]">
            {d.date && <span>{d.title} · {d.date}</span>}
            {d.url && <a href={d.url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">read full transcript →</a>}
          </div>

          {d.tone && <p><span className="font-semibold text-[var(--text)]">Tone </span><span className="text-[var(--text-2)]">{d.tone}</span></p>}
          {d.guidance && <p><span className="font-semibold text-[var(--text)]">Guidance </span><span className="text-[var(--text-2)]">{d.guidance}</span></p>}
          {d.topics && d.topics.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {d.topics.map((t, i) => <span key={i} className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] text-[var(--text-2)]">{t}</span>)}
            </div>
          )}

          {d.exchanges && d.exchanges.length > 0 && (
            <div>
              <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Analyst Q&amp;A — how directly management answered</div>
              <ul className="space-y-2">
                {d.exchanges.map((e, i) => {
                  const m = DIR_META[e.directness] || DIR_META.partial;
                  return (
                    <li key={i} className="rounded-lg border border-[var(--divider)] bg-[var(--bg)] p-2.5">
                      <div className="mb-1 flex flex-wrap items-center gap-1.5">
                        <span className="rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase" style={{ background: `${m.color}22`, color: m.color }}>{m.label}</span>
                        <span className="text-[11px] font-semibold text-[var(--text)]">{e.topic}</span>
                        {e.analyst && <span className="text-[10px] text-[var(--text-4)]">· {e.analyst}</span>}
                      </div>
                      {e.question && <p className="text-[var(--text-3)]"><span className="font-medium text-[var(--text-2)]">Q:</span> {e.question}</p>}
                      {e.answer && <p className="text-[var(--text-2)]"><span className="font-medium text-[var(--text)]">A:</span> {e.answer}</p>}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

          {d.whatChanged && d.whatChanged.length > 0 && (
            <div>
              <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-4)]">What changed vs. {d.priorDate || "last quarter"}</div>
              <ul className="space-y-1">{d.whatChanged.map((c, i) => <li key={i} className="text-[var(--text-2)]"><span className="text-[var(--accent)]">▸</span> {c}</li>)}</ul>
            </div>
          )}

          <p className="text-[10px] text-[var(--text-4)]">AI dissection of the call transcript — decision-support, verify against the source. Not investment advice.</p>
        </div>
      )}
    </div>
  );
}
