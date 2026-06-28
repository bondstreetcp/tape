"use client";
import { useEffect, useState } from "react";
import MarkdownLite from "./MarkdownLite";

interface Estimate { metric: string; period: string; value: number | null; unit?: string | null; priorValue: number | null; vsConsensus: string | null }
interface Doc { id: string; source: string; analysts: string[]; publishDate: string; title: string; rating: string | null; priceTarget: number | null; priceTargetPrior: number | null; thesis: string[]; risks: string[]; managementInsights: string[]; estimates: Estimate[]; summary: string; entitlement: string | null; blobKey: string | null }
interface Consensus { docCount: number; ratings: { rating: string; count: number }[]; ptStats: { min: number; max: number; median: number } | null; entitlements: string[] }

const ratingColor = (r: string | null) => /buy|outperform|overweight|add|accumulate/i.test(r || "") ? "#22c55e" : /sell|underperform|underweight|reduce/i.test(r || "") ? "#ef4444" : "#eab308";

export default function TickerResearch({ symbol, name }: { symbol: string; name?: string }) {
  const [state, setState] = useState<"loading" | "empty" | "ready">("loading");
  const [docs, setDocs] = useState<Doc[]>([]);
  const [cons, setCons] = useState<Consensus | null>(null);
  const [q, setQ] = useState("");
  const [answer, setAnswer] = useState<string | "loading" | null>(null);
  const [synth, setSynth] = useState<string | "loading" | null>(null);

  useEffect(() => {
    setState("loading"); setDocs([]); setCons(null); setAnswer(null); setSynth(null); setQ("");
    fetch(`/api/research?ticker=${encodeURIComponent(symbol)}`).then((r) => r.json()).then((d) => {
      if (d.available === false || !(d.docs || []).length) { setState("empty"); return; }
      setDocs(d.docs); setCons(d.consensus); setState("ready");
    }).catch(() => setState("empty"));
  }, [symbol]);

  const ask = (question?: string) => {
    const text = (question ?? q).trim();
    if (!text) return;
    setQ(text); setAnswer("loading");
    fetch("/api/research/synthesize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: symbol, question: text }) })
      .then((r) => r.json()).then((d) => setAnswer(d.answer || (d.error ? `_${d.error}_` : null))).catch(() => setAnswer(null));
  };
  const synthesize = () => {
    setSynth("loading");
    fetch("/api/research/synthesize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker: symbol }) })
      .then((r) => r.json()).then((d) => setSynth(d.synthesis || (d.error ? `_${d.error}_` : null))).catch(() => setSynth(null));
  };

  if (state === "loading") return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 text-center text-sm text-[var(--text-3)]">Loading research…</div>;

  if (state === "empty") {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="text-sm font-semibold text-[var(--text-2)]">No research ingested for {symbol}</div>
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-[var(--text-3)]">
          Add sell-side PDFs for {name || symbol} on the <a href="research-desk" className="text-[var(--accent)] hover:underline">Research Desk</a> (or <code className="rounded bg-[var(--surface-2)] px-1">npx tsx scripts/ingest-research.ts &lt;files&gt;</code>). Once ingested, you can search the reports here with the LLM. The corpus is private and stored locally.
        </p>
      </div>
    );
  }

  const examples = ["What do they say about HBM / 2027 pricing?", "Where do the brokers disagree?", "What are the bear-case risks?"];

  return (
    <div className="space-y-4">
      {/* LLM search — the hero */}
      <section className="rounded-xl border border-[#a855f7]/40 bg-[#a855f7]/[0.06] p-4">
        <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-2)]"><span className="text-base">🔎</span> Search the {symbol} research <span className="text-[11px] font-normal text-[var(--text-4)]">— grounded in the full report text</span></div>
        <div className="flex gap-2">
          <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder={`Ask the ${cons?.docCount ?? ""} ${symbol} notes anything…`} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--border-strong)]" />
          <button onClick={() => ask()} disabled={answer === "loading" || !q.trim()} className="rounded-lg bg-[#7c3aed] px-3 py-2 text-sm font-medium text-white hover:bg-[#6d28d9] disabled:opacity-50">{answer === "loading" ? "…" : "Ask"}</button>
        </div>
        {!answer && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {examples.map((e) => <button key={e} onClick={() => ask(e)} className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[11px] text-[var(--text-3)] hover:border-[var(--border-strong)] hover:text-[var(--text)]">{e}</button>)}
          </div>
        )}
        {answer && answer !== "loading" && <div className="mt-3 rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-body)]"><MarkdownLite text={answer} /></div>}
        {answer === "loading" && <div className="mt-3 text-[13px] text-[var(--text-3)]">Reading the reports…</div>}
      </section>

      {/* consensus strip */}
      {cons && (
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="font-semibold text-[var(--text-2)]">Street consensus</span>
              <span className="text-[var(--text-4)]">·</span>
              {cons.ratings.map((r) => <span key={r.rating} className="rounded px-1.5 py-0.5 text-xs font-medium" style={{ background: ratingColor(r.rating) + "22", color: ratingColor(r.rating) }}>{r.count}× {r.rating}</span>)}
              {cons.ptStats && <span className="text-sm text-[var(--text-3)]">· PT <span className="font-semibold tabular-nums text-[var(--text)]">${cons.ptStats.min}–${cons.ptStats.max}</span> (med ${cons.ptStats.median})</span>}
            </div>
            <button onClick={synthesize} disabled={synth === "loading"} className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs hover:border-[var(--border-strong)] disabled:opacity-60">{synth === "loading" ? "Synthesizing…" : "✨ Synthesize the Street"}</button>
          </div>
          {synth && synth !== "loading" && <div className="mt-3 rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-body)]"><MarkdownLite text={synth} /></div>}
        </section>
      )}

      {/* notes */}
      <div className="space-y-2">
        {docs.map((d) => (
          <section key={d.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="text-sm font-semibold text-[var(--text)]">{d.source}</span>
                {d.rating && <span className="rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: ratingColor(d.rating) + "22", color: ratingColor(d.rating) }}>{d.rating}</span>}
                {d.priceTarget != null && <span className="text-xs tabular-nums text-[var(--text-2)]">PT {d.priceTargetPrior != null ? `$${d.priceTargetPrior}→` : ""}<span className="font-semibold text-[var(--text)]">${d.priceTarget}</span></span>}
              </div>
              <span className="flex items-center gap-2 text-[11px] text-[var(--text-4)]">
                {d.blobKey && <a href={`/api/research/pdf?id=${d.id}`} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">📄 PDF</a>}
                {d.publishDate}
              </span>
            </div>
            {d.summary && <p className="mt-1 text-[12px] leading-relaxed text-[var(--text-3)]">{d.summary}</p>}
            {d.managementInsights?.length > 0 && (
              <div className="mt-2 rounded-lg border border-[#22c55e]/30 bg-[#22c55e]/[0.06] p-2">
                <div className="mb-0.5 text-[11px] font-semibold text-[#22c55e]">👤 Management &amp; expert color</div>
                <ul className="list-disc space-y-0.5 pl-4 text-[12px] text-[var(--text-2)]">
                  {d.managementInsights.map((m, i) => <li key={i}>{m}</li>)}
                </ul>
              </div>
            )}
          </section>
        ))}
      </div>
      {cons && cons.entitlements.length > 0 && <p className="text-[10px] text-[var(--text-4)]">⚠ {cons.entitlements.length} note(s) entitlement-watermarked — private, do not redistribute.</p>}
    </div>
  );
}
