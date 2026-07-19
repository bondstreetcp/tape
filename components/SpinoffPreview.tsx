"use client";
import { useEffect, useRef, useState } from "react";
import { type TwoEntityPreview, type SpinEntity, previewHasDetail } from "@/lib/spinoffPreview";

// Lazy TWO-ENTITY preview for an upcoming spin — "run a report on the two." Click to open a modal that
// fuses the SpinCo's Form 10, the parent's own 10-K (where the segment's financials live), and any
// ingested broker/analyst-day notes into a side-by-side read: RemainCo vs SpinCo, mechanics, and the
// economics contrast. Fetched on first open (expensive PRO synthesis), cached server-side.

function Sect({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{title}</h4>
      <div className="text-[12.5px] leading-relaxed text-[var(--text-2)]">{children}</div>
    </div>
  );
}

function EntityCol({ e, accent }: { e: SpinEntity; accent: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-3.5">
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[13px] font-bold" style={{ color: accent }}>{e.name}</span>
        {e.ticker && <span className="rounded border border-[var(--border)] px-1 py-0.5 font-mono text-[10px] text-[var(--text-3)]">{e.ticker}</span>}
        <span className="ml-auto text-[10px] uppercase tracking-wide text-[var(--text-4)]">{e.role === "remainco" ? "stays" : "spins off"}</span>
      </div>
      <div className="space-y-2.5">
        {e.whatItIs && <Sect title="The business">{e.whatItIs}</Sect>}
        {e.financials && <Sect title="Financials (as stated)">{e.financials}</Sect>}
        {e.economics && <Sect title="Economics">{e.economics}</Sect>}
        {e.whyOwnIt && <Sect title="Why own this piece">{e.whyOwnIt}</Sect>}
        {e.risks.length > 0 && (
          <Sect title="Key risks">
            <ul className="list-disc space-y-0.5 pl-4">{e.risks.map((x, i) => <li key={i}>{x}</li>)}</ul>
          </Sect>
        )}
      </div>
    </div>
  );
}

function Body({ p }: { p: TwoEntityPreview }) {
  const m = p.mechanics;
  return (
    <div className="space-y-4">
      {m && (
        <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px]">
          {m.ratio && <span className="text-[var(--text-2)]"><b className="text-[var(--text)]">Ratio</b> {m.ratio}</span>}
          {m.recordDate && <span className="text-[var(--text-2)]"><b className="text-[var(--text)]">Record</b> {m.recordDate}</span>}
          {m.distributionDate && <span className="text-[var(--text-2)]"><b className="text-[var(--text)]">Distribution</b> {m.distributionDate}</span>}
          {m.whenIssued && <span className="text-[var(--text-3)]">{m.whenIssued}</span>}
          {m.note && <span className="w-full text-[11px] text-[var(--text-4)]">{m.note}</span>}
        </div>
      )}
      <div className="grid gap-3 md:grid-cols-2">
        {p.remainco && <EntityCol e={p.remainco} accent="#60a5fa" />}
        {p.spincoEntity && <EntityCol e={p.spincoEntity} accent="#a78bfa" />}
      </div>
      {p.contrast && (
        <div className="rounded-lg bg-[var(--accent-soft)] px-3 py-2.5">
          <Sect title="The two, head to head">{p.contrast}</Sect>
        </div>
      )}
      {p.researchRead && (
        <div className="rounded-lg border border-[color-mix(in_oklab,#22c55e_35%,transparent)] px-3 py-2.5">
          <Sect title="What the ingested research adds">{p.researchRead}</Sect>
        </div>
      )}
      {/* Only claim "no notes ingested" when the corpus was CHECKED and is empty (false) — null means
          the store couldn't be reached in time, and asserting emptiness then would mislead. */}
      {p.hasResearch === false && (
        <p className="text-[11.5px] text-[var(--text-4)]">
          No broker/analyst-day notes ingested for {p.parent.ticker ?? p.parent.name} yet — this read is filings-only. Upload the notes in the Research Desk and re-open to enrich it (standalone margin/ROE frames live there, not in filings).
        </p>
      )}
      {p.watchItems.length > 0 && (
        <Sect title="What to watch">
          <ul className="list-disc space-y-0.5 pl-4">{p.watchItems.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Sect>
      )}
      <p className="border-t border-[var(--divider)] pt-2 text-[10px] leading-relaxed text-[var(--text-4)]">
        Sources: {p.sources.map((s, i) => (
          <span key={i}>{i > 0 && " · "}<a href={s.url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">{s.label} ({s.date})</a></span>
        ))}{p.hasResearch ? " · ingested broker notes" : ""}. Figures are labelled with their source; the filings are the issuers&apos; own accounts. Research, not advice.
      </p>
    </div>
  );
}

export default function SpinoffPreview({ cik, spinco, parent }: { cik: string; spinco: string; parent: string | null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<TwoEntityPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const inflight = useRef(false);

  useEffect(() => {
    if (!open) return;
    // CAPTURE phase + stopPropagation: this modal can stack on top of the Briefing modal (same row,
    // both z-50, keyboard-reachable) — capture fires before the Briefing's bubble-phase listener, so
    // one Escape dismisses only THIS (topmost) modal instead of both at once.
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { e.stopPropagation(); setOpen(false); } };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  // `force` bypasses the stale-closure `data` guard — setData(null) in the same tick doesn't update
  // the closure this call reads, so a plain load() after a server failure (data = a truthy note-shell)
  // bailed silently and "Try again" needed two clicks.
  const load = async (force = false) => {
    if ((!force && data) || inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      // 75s abort — the server answers in ≲60s (its own wall-clock ceiling); on the self-hosted
      // origin nothing else backstops a hung connection.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 75_000);
      const r = await fetch(`/api/spinoff-preview/${encodeURIComponent(cik)}`, { signal: ctrl.signal }).then((x) => x.json()).finally(() => clearTimeout(timer));
      setData(r && typeof r === "object" ? r : null);
    } catch {
      setData(null);
    }
    inflight.current = false;
    setLoading(false);
  };
  const openIt = () => { setOpen(true); load(); };

  return (
    <>
      <button onClick={openIt} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-3)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]" title="The spin as TWO investable entities — RemainCo vs SpinCo, side by side, from the Form 10 + the parent's 10-K + any ingested research">Two-entity preview →</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={() => setOpen(false)}>
          <div className="my-auto w-full max-w-4xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-[var(--text)]">{parent ?? "Parent"} → {spinco}</h3>
                <p className="text-[12px] text-[var(--text-4)]">Two-entity spin preview · what stays vs what spins</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]">✕</button>
            </div>
            {loading && !data ? (
              <div className="py-12 text-center text-[13px] text-[var(--text-4)]">Reading the Form 10 + {parent ?? "the parent"}&apos;s 10-K and building the two-entity read… <span className="text-[11px]">(10-30 seconds)</span></div>
            ) : previewHasDetail(data) ? (
              <Body p={data!} />
            ) : (
              <div className="py-10 text-center text-[13px] text-[var(--text-4)]">
                {data?.note ?? "No two-entity preview available for this filing."}{" "}
                {!loading && <button onClick={() => { setData(null); load(true); }} className="text-[var(--accent)] underline hover:no-underline">Try again</button>}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
