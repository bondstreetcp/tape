"use client";
import { useState } from "react";
import MarkdownLite from "./MarkdownLite";

interface Peer { symbol: string; name: string }

export default function AiCompare({ symbol, name, peers }: { symbol: string; name: string; peers: Peer[] }) {
  const [other, setOther] = useState("");
  const [loading, setLoading] = useState(false);
  const [answer, setAnswer] = useState<string | null>(null);
  const [sources, setSources] = useState<{ title: string; uri: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [vs, setVs] = useState("");

  const quick = peers.filter((p) => p.symbol.toUpperCase() !== symbol.toUpperCase()).slice(0, 6);

  const run = (raw: string) => {
    const o = raw.trim().toUpperCase();
    if (!o || o === symbol.toUpperCase() || loading) return;
    setLoading(true); setError(null); setAnswer(null); setVs(o);
    const otherName = peers.find((p) => p.symbol.toUpperCase() === o)?.name || o;
    fetch("/api/ai-compare", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: [symbol, o], names: [name, otherName] }),
    })
      .then((r) => r.json())
      .then((d) => {
        setLoading(false);
        if (d.configured === false) setError("AI compare needs a GEMINI_API_KEY configured.");
        else if (d.answer) { setAnswer(d.answer); setSources(d.sources || []); }
        else setError(d.error || "Couldn't generate the comparison.");
      })
      .catch(() => { setLoading(false); setError("Something went wrong reaching the AI."); });
  };

  return (
    <section className="mb-4 rounded-xl border border-[#a855f7]/40 bg-[#a855f7]/[0.06] p-4">
      <div className="mb-2 flex items-center gap-2">
        <span className="text-sm font-semibold text-[var(--text)]">🆚 AI head-to-head</span>
        <span className="text-[11px] text-[var(--text-4)]">— compare {symbol} with another company</span>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") run(other); }}
          placeholder="Ticker to compare with…"
          className="w-44 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm uppercase outline-none placeholder:normal-case placeholder:text-[var(--text-4)] focus:border-[#a855f7]/60"
        />
        <button
          onClick={() => run(other)}
          disabled={loading || !other.trim()}
          className="rounded-lg bg-[#a855f7] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#9333ea] disabled:opacity-50"
        >
          {loading ? "Comparing…" : "Compare"}
        </button>
      </div>

      {quick.length > 0 && !answer && !loading && (
        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[var(--text-4)]">Peers:</span>
          {quick.map((p) => (
            <button
              key={p.symbol}
              onClick={() => { setOther(p.symbol); run(p.symbol); }}
              title={p.name}
              className="rounded-full border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1 font-mono text-[11px] text-[var(--text-3)] transition-colors hover:border-[#a855f7]/50 hover:text-[var(--text)]"
            >
              {p.symbol}
            </button>
          ))}
        </div>
      )}

      {loading && (
        <div className="mt-3 flex items-center gap-2 text-[13px] text-[var(--text-3)]">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--text-4)] border-t-transparent" />
          Comparing {symbol} vs {vs} — gathering both companies&apos; data &amp; the latest web…
        </div>
      )}
      {error && <p className="mt-2 text-xs text-[#ef4444]">{error}</p>}

      {answer && (
        <div className="mt-3">
          <div className="mb-1.5 text-xs font-semibold text-[var(--text-2)]">{symbol} vs {vs}</div>
          <div className="rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-body)]">
            <MarkdownLite text={answer} />
          </div>
          {sources.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {sources.map((s, i) => (
                <a key={i} href={s.uri} target="_blank" rel="noreferrer" title={s.title} className="max-w-[220px] truncate rounded-full border border-[var(--border)] bg-[var(--surface-2)] px-2.5 py-1 text-[11px] text-[var(--accent)] hover:border-[var(--border-strong)]">{s.title} ↗</a>
              ))}
            </div>
          )}
          <p className="mt-1.5 text-[10px] text-[var(--text-4)]">
            AI-generated · <button onClick={() => { setAnswer(null); setOther(""); }} className="underline hover:text-[var(--text-2)]">new comparison</button> · not investment advice.
          </p>
        </div>
      )}
    </section>
  );
}
