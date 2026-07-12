"use client";
import { useEffect, useRef, useState } from "react";
import { type SpinoffReport, reportHasDetail } from "@/lib/spinoffReport";
import { fmtDate } from "@/lib/format";

// Lazy "Briefing" for an upcoming spin — click to open a modal that reads the SpinCo's Form 10 and
// synthesizes a generalist's primer (industry, competitors, customers, suppliers, risks, financials).
// Fetched on first open (the extraction is expensive), cached hard server-side.

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <h4 className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{title}</h4>
      <div className="text-[13px] leading-relaxed text-[var(--text-2)]">{children}</div>
    </div>
  );
}
const Chips = ({ items, color }: { items: string[]; color: string }) => (
  <div className="flex flex-wrap gap-1.5">
    {items.map((s, i) => (
      <span key={i} className="rounded-md border px-1.5 py-0.5 text-[12px]" style={{ borderColor: `color-mix(in oklab, ${color} 40%, transparent)`, color, background: `color-mix(in oklab, ${color} 10%, transparent)` }}>{s}</span>
    ))}
  </div>
);

function Body({ r, spinco, parent }: { r: SpinoffReport; spinco: string; parent: string | null }) {
  return (
    <div className="space-y-4">
      {r.whatItIs && <Section title="What it is">{r.whatItIs}{r.howItMakesMoney && <span className="text-[var(--text-3)]"> {r.howItMakesMoney}</span>}</Section>}
      {r.whySpun && <Section title="Why it's being spun off">{r.whySpun}</Section>}
      {r.industry && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
          <Section title="How the industry works (for a generalist)">{r.industry}</Section>
        </div>
      )}
      {(r.competitivePosition || r.competitors.length > 0) && (
        <Section title="Competitive position">
          {r.competitivePosition}
          {r.competitors.length > 0 && (
            <div className="mt-1.5">
              <span className="mr-1.5 text-[11px] text-[var(--text-4)]">Named rivals:</span>
              <span className="inline-flex flex-wrap gap-1.5 align-middle"><Chips items={r.competitors} color="#f59e0b" /></span>
            </div>
          )}
        </Section>
      )}
      <div className="grid gap-4 sm:grid-cols-2">
        {r.customers && <Section title="Customers">{r.customers}</Section>}
        {r.suppliers && <Section title="Suppliers & inputs">{r.suppliers}</Section>}
      </div>
      {r.moats.length > 0 && <Section title="Claimed advantages"><Chips items={r.moats} color="#22c55e" /></Section>}
      {r.risks.length > 0 && (
        <Section title="Key risks">
          <ul className="list-disc space-y-0.5 pl-4">{r.risks.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Section>
      )}
      {r.watchItems.length > 0 && (
        <Section title="What to watch">
          <ul className="list-disc space-y-0.5 pl-4">{r.watchItems.map((x, i) => <li key={i}>{x}</li>)}</ul>
        </Section>
      )}
      {r.financials && (
        <Section title="Financial snapshot">
          <div className="flex flex-wrap gap-x-5 gap-y-1">
            {r.financials.revenue && <span>Revenue: <b className="text-[var(--text)]">{r.financials.revenue}</b></span>}
            {r.financials.growth && <span>Growth: <b className="text-[var(--text)]">{r.financials.growth}</b></span>}
            {r.financials.profitability && <span>Profitability: <b className="text-[var(--text)]">{r.financials.profitability}</b></span>}
          </div>
          {r.financials.note && <div className="mt-1 text-[11px] text-[var(--text-4)]">{r.financials.note}</div>}
        </Section>
      )}
      <p className="border-t border-[var(--divider)] pt-2 text-[10px] leading-relaxed text-[var(--text-4)]">
        Drawn entirely from {spinco}&apos;s own {r.source ? <a href={r.source.url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">{r.source.date} Form 10</a> : "Form 10"} — so it&apos;s {parent ? `${parent}'s/` : "the "}issuer&apos;s framing of its industry and rivals; a full picture cross-checks the competitors&apos; own filings. Named competitors are pulled verbatim from the filing; nothing is inferred or added from outside. Research, not advice.
      </p>
    </div>
  );
}

export default function SpinoffBriefing({ cik, spinco, parent }: { cik: string; spinco: string; parent: string | null }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<SpinoffReport | null>(null);
  const [loading, setLoading] = useState(false);
  const inflight = useRef(false);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const load = async () => {
    if (data || inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const r = await fetch(`/api/spinoff-report/${encodeURIComponent(cik)}`).then((x) => x.json());
      setData(r && typeof r === "object" ? r : null);
    } catch { setData({ cik, spinco, parent, source: null, whatItIs: null, whySpun: null, howItMakesMoney: null, industry: null, competitivePosition: null, competitors: [], customers: null, suppliers: null, moats: [], risks: [], watchItems: [], financials: null, note: "Couldn't load the briefing." }); }
    setLoading(false);
  };
  const openIt = () => { setOpen(true); load(); };

  return (
    <>
      <button onClick={openIt} className="rounded border border-[var(--border)] px-1.5 py-0.5 text-[11px] font-medium text-[var(--text-3)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]" title="Read a generalist's briefing drilled from the Form 10">Briefing →</button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/60 p-4 sm:p-8" onClick={() => setOpen(false)}>
          <div className="my-auto w-full max-w-2xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-bold text-[var(--text)]">{spinco}</h3>
                <p className="text-[12px] text-[var(--text-4)]">Spin-off briefing{parent ? ` · from ${parent}` : ""}</p>
              </div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]">✕</button>
            </div>
            {loading && !data ? (
              <div className="py-12 text-center text-[13px] text-[var(--text-4)]">Reading {spinco}&apos;s Form 10 and building the briefing… <span className="text-[11px]">(a few seconds)</span></div>
            ) : reportHasDetail(data) ? (
              <Body r={data!} spinco={spinco} parent={parent} />
            ) : (
              <div className="py-10 text-center text-[13px] text-[var(--text-4)]">{data?.note ?? "No briefing available for this filing."}</div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
