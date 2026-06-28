"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import MarkdownLite from "./MarkdownLite";
import Button from "./Button";

interface Estimate { metric: string; period: string; value: number | null; unit?: string | null; priorValue: number | null; vsConsensus: string | null }
interface Doc { id: string; ticker: string; company: string; source: string; analysts: string[]; publishDate: string; docType: string; title: string; rating: string | null; priceTarget: number | null; priceTargetPrior: number | null; targetBasis: string | null; thesis: string[]; risks: string[]; catalysts: string[]; estimates: Estimate[]; summary: string; entitlement: string | null; fileName: string; pageCount: number; blobKey: string | null }
interface MetricRow { source: string; value: number | null; priorValue: number | null; unit: string | null; vsConsensus: string | null }
interface Consensus { docCount: number; ratings: { rating: string; count: number }[]; priceTargets: { source: string; date: string; target: number; prior: number | null }[]; ptStats: { min: number; max: number; median: number } | null; battlegrounds: { label: string; rows: MetricRow[] }[]; entitlements: string[] }
type IndexRow = { ticker: string; company: string; count: number; latest: string };
interface Signal { id: string; ticker: string; source: string; date: string; rating: string | null; ratingChanged: boolean; pt: number | null; ptChangePct: number | null; topRevision: { metric: string; period: string; changePct: number } | null; mgmtColor: number; score: number }
interface Hit { docId: string; ticker: string; source: string; date: string; snippet: string; score: number }

const ratingColor = (r: string | null) => /buy|outperform|overweight|add|accumulate/i.test(r || "") ? "#22c55e" : /sell|underperform|underweight|reduce/i.test(r || "") ? "#ef4444" : "#eab308";
const money = (v: number | null, unit?: string | null) => {
  if (v == null) return "—";
  const u = (unit || "").toLowerCase();
  if (u.includes("%")) return `${v}%`;
  if (u === "$b" || u.includes("billion")) return `$${v}B`;
  return `$${v}`; // EPS / $/share / USD / unlabeled
};

export default function ResearchDesk() {
  const [available, setAvailable] = useState(true);
  const [index, setIndex] = useState<IndexRow[] | null>(null);
  const [ticker, setTicker] = useState<string | null>(null);
  const [data, setData] = useState<{ docs: Doc[]; consensus: Consensus } | null>(null);
  const [synth, setSynth] = useState<string | "loading" | null>(null);
  const [answer, setAnswer] = useState<string | "loading" | null>(null);
  const [q, setQ] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [signals, setSignals] = useState<Signal[]>([]);
  const [idea, setIdea] = useState<string | "loading" | null>(null);
  const [sq, setSq] = useState("");
  const [sres, setSres] = useState<{ answer: string | null; hits: Hit[] } | "loading" | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const runSearch = () => {
    if (!sq.trim()) return;
    setSres("loading");
    fetch("/api/research/search", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ query: sq }) })
      .then((r) => r.json()).then((d) => setSres(d.available === false ? { answer: null, hits: [] } : { answer: d.answer, hits: d.hits || [] })).catch(() => setSres(null));
  };

  const loadIndex = useCallback(() => {
    fetch("/api/research").then((r) => r.json()).then((d) => { setAvailable(d.available !== false); setIndex(d.index || []); });
    fetch("/api/research/actionable").then((r) => r.json()).then((d) => setSignals(d.signals || []));
  }, []);
  useEffect(() => { loadIndex(); }, [loadIndex]);

  const scanIdeas = () => {
    setIdea("loading");
    fetch("/api/research/actionable", { method: "POST" }).then((r) => r.json()).then((d) => setIdea(d.digest || (d.error ? `_${d.error}_` : null))).catch(() => setIdea(null));
  };

  const openTicker = (t: string) => {
    setTicker(t); setData(null); setSynth(null); setAnswer(null); setQ("");
    fetch(`/api/research?ticker=${encodeURIComponent(t)}`).then((r) => r.json()).then((d) => setData({ docs: d.docs || [], consensus: d.consensus }));
  };

  const runSynth = () => {
    setSynth("loading");
    fetch("/api/research/synthesize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker }) })
      .then((r) => r.json()).then((d) => setSynth(d.synthesis || (d.error ? `_${d.error}_` : null))).catch(() => setSynth(null));
  };
  const ask = () => {
    if (!q.trim()) return;
    setAnswer("loading");
    fetch("/api/research/synthesize", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ticker, question: q }) })
      .then((r) => r.json()).then((d) => setAnswer(d.answer || (d.error ? `_${d.error}_` : null))).catch(() => setAnswer(null));
  };
  const upload = (file: File) => {
    setBusy("Ingesting " + file.name + "…");
    const fd = new FormData(); fd.append("file", file);
    fetch("/api/research/upload", { method: "POST", body: fd }).then((r) => r.json()).then((d) => {
      setBusy(d.ok ? null : (d.error || "Upload failed"));
      if (d.ok) { loadIndex(); openTicker(d.doc.ticker); if (d.error == null) setTimeout(() => setBusy(null), 0); }
    }).catch(() => setBusy("Upload failed"));
  };

  const uploadBtn = (
    <>
      <input ref={fileRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) upload(f); e.target.value = ""; }} />
      <button onClick={() => fileRef.current?.click()} className="rounded-lg border border-[#a855f7]/50 bg-[#a855f7]/[0.08] px-3 py-1.5 text-sm font-medium text-[var(--text-2)] hover:bg-[#a855f7]/[0.15]">＋ Ingest a research PDF</button>
    </>
  );

  if (!available) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <div className="text-sm font-semibold text-[var(--text-2)]">Research corpus is empty</div>
        <p className="mt-1 max-w-prose text-xs leading-relaxed text-[var(--text-3)]">
          Ingest sell-side PDFs to build the desk. Locally that runs <code className="rounded bg-[var(--surface-2)] px-1">npx tsx scripts/ingest-research.ts &lt;files&gt;</code> or the button below; the corpus is stored privately
          (gitignored) and never deployed. For the live site, wire the store to Supabase (Blob + pgvector).
        </p>
        <div className="mt-3">{uploadBtn}</div>
        {busy && <div className="mt-2 text-xs text-[var(--text-3)]">{busy}</div>}
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-1.5 text-sm">
          <button onClick={() => { setTicker(null); setData(null); }} className={"rounded-md px-2 py-1 " + (!ticker ? "bg-[var(--surface-hover)] text-[var(--text)]" : "text-[var(--text-3)] hover:text-[var(--text)]")}>Corpus</button>
          {(index || []).map((r) => (
            <button key={r.ticker} onClick={() => openTicker(r.ticker)} className={"rounded-md px-2 py-1 font-mono " + (ticker === r.ticker ? "bg-[var(--surface-hover)] text-[var(--text)]" : "text-[var(--text-3)] hover:text-[var(--text)]")}>
              {r.ticker} <span className="text-[10px] text-[var(--text-4)]">{r.count}</span>
            </button>
          ))}
        </div>
        {uploadBtn}
      </div>
      {busy && <div className="rounded-md bg-[var(--surface-2)] px-3 py-1.5 text-xs text-[var(--text-3)]">{busy}</div>}

      {/* semantic search across the whole corpus */}
      {!ticker && (
        <section className="rounded-xl border border-[#3b82f6]/40 bg-[#3b82f6]/[0.06] p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-[var(--text-2)]"><span className="text-base">🔭</span> Search all research <span className="text-[11px] font-normal text-[var(--text-4)]">— semantic search across every note, regardless of ticker</span></div>
          <div className="flex gap-2">
            <input value={sq} onChange={(e) => setSq(e.target.value)} onKeyDown={(e) => e.key === "Enter" && runSearch()} placeholder='e.g. "HBM 2027 pricing", "channel checks on demand", "China supply risk"' className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--border-strong)]" />
            <Button onClick={runSearch} variant="primary" disabled={sres === "loading" || !sq.trim()}>{sres === "loading" ? "…" : "Search"}</Button>
          </div>
          {sres === "loading" && <div className="mt-3 text-[13px] text-[var(--text-3)]">Retrieving the most relevant passages…</div>}
          {sres && sres !== "loading" && (
            <div className="mt-3 space-y-3">
              {sres.answer && <div className="rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-body)]"><MarkdownLite text={sres.answer} /></div>}
              {sres.hits.length === 0 ? <div className="text-xs text-[var(--text-3)]">No matching passages yet — ingest more research.</div> : (
                <div className="space-y-1.5">
                  {sres.hits.slice(0, 8).map((h, i) => (
                    <button key={i} onClick={() => openTicker(h.ticker)} className="block w-full rounded-md border border-[var(--divider)] px-3 py-2 text-left hover:bg-[var(--surface-hover)]">
                      <div className="mb-0.5 flex flex-wrap items-center gap-x-2 text-[11px] text-[var(--text-4)]"><span className="font-mono font-semibold text-[var(--text-2)]">{h.ticker}</span> · {h.source} · {h.date} · <span className="tabular-nums">{(h.score * 100).toFixed(0)}% match</span></div>
                      <div className="text-[12px] leading-snug text-[var(--text-3)]">{h.snippet.slice(0, 240)}{h.snippet.length > 240 ? "…" : ""}</div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </section>
      )}

      {/* actionable — idea generation across the whole corpus */}
      {!ticker && signals.length > 0 && (
        <section className="rounded-xl border border-[#a855f7]/40 bg-[#a855f7]/[0.06] p-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm font-medium text-[var(--text-2)]"><span className="text-base">🎯</span> Actionable — idea generation <span className="text-[11px] font-normal text-[var(--text-4)]">— the Street's biggest moves across your research</span></span>
            <button onClick={scanIdeas} disabled={idea === "loading"} className="rounded-lg bg-[#7c3aed] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#6d28d9] disabled:opacity-60">{idea === "loading" ? "Scanning…" : "✨ Scan for ideas"}</button>
          </div>
          {idea && idea !== "loading" && <div className="mb-3 rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-body)]"><MarkdownLite text={idea} /></div>}
          <div className="space-y-0.5">
            {signals.slice(0, 8).map((s) => (
              <button key={s.id} onClick={() => openTicker(s.ticker)} className="flex w-full flex-wrap items-center gap-x-3 gap-y-0.5 rounded-md px-2 py-1 text-left text-xs hover:bg-[var(--surface-hover)]">
                <span className="w-12 shrink-0 font-mono font-semibold text-[var(--text)]">{s.ticker}</span>
                <span className="text-[var(--text-3)]">{s.source.split(" ")[0]}</span>
                {s.ptChangePct != null && <span className="tabular-nums font-medium" style={{ color: s.ptChangePct >= 0 ? "#22c55e" : "#ef4444" }}>PT {s.ptChangePct >= 0 ? "+" : ""}{s.ptChangePct.toFixed(0)}%</span>}
                {s.ratingChanged && <span className="rounded bg-[#eab308]/20 px-1 text-[#eab308]">rating Δ</span>}
                {s.topRevision && <span className="tabular-nums text-[var(--text-3)]">{s.topRevision.metric} {s.topRevision.changePct >= 0 ? "+" : ""}{s.topRevision.changePct.toFixed(0)}%</span>}
                {s.mgmtColor > 0 && <span className="text-[#22c55e]">👤 {s.mgmtColor}</span>}
              </button>
            ))}
          </div>
        </section>
      )}

      {/* corpus index */}
      {!ticker && (
        <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          {(index || []).length === 0 ? (
            <div className="p-6 text-center text-sm text-[var(--text-3)]">No documents yet — ingest a PDF to begin.</div>
          ) : (index || []).map((r) => (
            <button key={r.ticker} onClick={() => openTicker(r.ticker)} className="flex w-full items-center justify-between border-b border-[var(--divider)] px-4 py-3 text-left last:border-0 hover:bg-[var(--surface-hover)]">
              <span><span className="font-mono font-semibold text-[var(--text)]">{r.ticker}</span> <span className="text-sm text-[var(--text-3)]">{r.company}</span></span>
              <span className="text-xs text-[var(--text-4)]">{r.count} note{r.count > 1 ? "s" : ""} · latest {r.latest}</span>
            </button>
          ))}
        </div>
      )}

      {/* per-ticker desk */}
      {ticker && data && (
        <>
          {/* consensus */}
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="text-sm font-semibold text-[var(--text-2)]">Consensus · {ticker} <span className="font-normal text-[var(--text-4)]">({data.consensus.docCount} notes)</span></h3>
              <div className="flex flex-wrap items-center gap-1.5">
                {data.consensus.ratings.map((r) => (
                  <span key={r.rating} className="rounded px-1.5 py-0.5 text-xs font-medium" style={{ background: ratingColor(r.rating) + "22", color: ratingColor(r.rating) }}>{r.count}× {r.rating}</span>
                ))}
              </div>
            </div>
            {data.consensus.ptStats && (
              <div className="mb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-sm">
                <span className="text-[var(--text-3)]">Price target range <span className="font-semibold tabular-nums text-[var(--text)]">${data.consensus.ptStats.min}–${data.consensus.ptStats.max}</span> · median <span className="font-semibold tabular-nums text-[var(--text)]">${data.consensus.ptStats.median}</span></span>
              </div>
            )}
            {/* battlegrounds */}
            {data.consensus.battlegrounds.map((b) => (
              <div key={b.label} className="mt-2">
                <div className="mb-1 text-xs font-medium text-[var(--text-3)]">{b.label}</div>
                <div className="flex flex-wrap gap-1.5">
                  {b.rows.sort((a, z) => (z.value ?? 0) - (a.value ?? 0)).map((r, i) => (
                    <span key={i} className="rounded border border-[var(--border)] bg-[var(--bg)] px-2 py-0.5 text-xs tabular-nums" title={r.vsConsensus || undefined}>
                      <span className="text-[var(--text-3)]">{r.source.split(" ")[0]}</span> <span className="font-semibold text-[var(--text)]">{money(r.value, r.unit)}</span>{r.priorValue != null && <span className="text-[var(--text-4)]"> (was {money(r.priorValue, r.unit)})</span>}
                    </span>
                  ))}
                </div>
              </div>
            ))}
            <div className="mt-3 flex flex-wrap gap-2">
              <button onClick={runSynth} disabled={synth === "loading"} className="rounded-lg bg-[#7c3aed] px-3 py-1.5 text-sm font-medium text-white hover:bg-[#6d28d9] disabled:opacity-60">{synth === "loading" ? "Synthesizing…" : "✨ Synthesize the Street"}</button>
            </div>
            {synth && synth !== "loading" && (
              <div className="mt-3 rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-body)]"><MarkdownLite text={synth} /></div>
            )}
            {data.consensus.entitlements.length > 0 && (
              <p className="mt-2 text-[10px] text-[var(--text-4)]">⚠ {data.consensus.entitlements.length} note(s) are entitlement-watermarked — keep private, do not redistribute.</p>
            )}
          </section>

          {/* ask the corpus */}
          <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
            <div className="flex gap-2">
              <input value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={(e) => e.key === "Enter" && ask()} placeholder={`Ask across all ${ticker} notes — e.g. "what do they say about LTAs / HBM 2027 pricing?"`} className="flex-1 rounded-lg border border-[var(--border)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--text)] outline-none focus:border-[var(--border-strong)]" />
              <button onClick={ask} disabled={answer === "loading" || !q.trim()} className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:border-[var(--border-strong)] disabled:opacity-50">{answer === "loading" ? "…" : "Ask"}</button>
            </div>
            {answer && answer !== "loading" && (
              <div className="mt-3 rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] p-3 text-[13px] text-[var(--text-body)]"><MarkdownLite text={answer} /></div>
            )}
          </section>

          {/* per-note extractions */}
          <div className="space-y-3">
            {data.docs.map((d) => (
              <section key={d.id} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
                <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
                  <div className="flex flex-wrap items-baseline gap-2">
                    <span className="text-sm font-semibold text-[var(--text)]">{d.source}</span>
                    {d.rating && <span className="rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ background: ratingColor(d.rating) + "22", color: ratingColor(d.rating) }}>{d.rating}</span>}
                    {d.priceTarget != null && <span className="text-xs tabular-nums text-[var(--text-2)]">PT {d.priceTargetPrior != null ? `$${d.priceTargetPrior} → ` : ""}<span className="font-semibold text-[var(--text)]">${d.priceTarget}</span></span>}
                  </div>
                  <span className="flex items-center gap-2 text-[11px] text-[var(--text-4)]">
                    {d.blobKey && <a href={`/api/research/pdf?id=${d.id}`} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">📄 PDF</a>}
                    {d.publishDate} · {d.analysts.slice(0, 2).join(", ")}
                  </span>
                </div>
                <div className="text-xs text-[var(--text-3)]">{d.title}</div>
                {d.summary && <p className="mt-1.5 text-[13px] leading-relaxed text-[var(--text-body)]">{d.summary}</p>}
                {d.thesis.length > 0 && (
                  <ul className="mt-2 list-disc space-y-0.5 pl-4 text-[12px] text-[var(--text-2)]">
                    {d.thesis.slice(0, 4).map((t, i) => <li key={i}>{t}</li>)}
                  </ul>
                )}
                <details className="mt-2">
                  <summary className="cursor-pointer text-[11px] text-[var(--accent)]">estimates &amp; risks</summary>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {d.estimates.map((e, i) => (
                      <span key={i} className="rounded bg-[var(--bg)] px-1.5 py-0.5 text-[11px] tabular-nums text-[var(--text-3)]" title={e.vsConsensus || undefined}>{e.metric} {e.period}: <span className="text-[var(--text)]">{money(e.value, e.unit)}</span></span>
                    ))}
                  </div>
                  {d.risks.length > 0 && <div className="mt-1.5 text-[11px] text-[var(--text-3)]"><span className="text-[var(--text-4)]">Risks:</span> {d.risks.join(" · ")}</div>}
                </details>
              </section>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
