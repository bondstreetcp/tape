"use client";
import { useState, useRef } from "react";
import { type CompanyBriefing, briefingHasDetail } from "@/lib/companyBriefing";

// "Business briefing" card on the stock profile — a generalist's primer drilled from the latest 10-K:
// what the business is, how the industry works, the named competitors, customers/suppliers, risks and
// watch-items. Lazy: nothing is fetched until the user clicks (the extraction reads the full 10-K).

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{title}</div>
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

function Body({ r }: { r: CompanyBriefing }) {
  return (
    <div className="space-y-4">
      {r.whatItIs && <Section title="What it is">{r.whatItIs}{r.howItMakesMoney && <span className="text-[var(--text-3)]"> {r.howItMakesMoney}</span>}</Section>}
      {r.industry && (
        <div className="rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3">
          <Section title="How the industry works">{r.industry}</Section>
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
        <Section title="Key risks"><ul className="list-disc space-y-0.5 pl-4">{r.risks.map((x, i) => <li key={i}>{x}</li>)}</ul></Section>
      )}
      {r.watchItems.length > 0 && (
        <Section title="What to watch"><ul className="list-disc space-y-0.5 pl-4">{r.watchItems.map((x, i) => <li key={i}>{x}</li>)}</ul></Section>
      )}
      <p className="border-t border-[var(--divider)] pt-2 text-[10px] leading-relaxed text-[var(--text-4)]">
        Drilled from the company&apos;s own {r.source ? <a href={r.source.url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">{r.source.date} {r.source.form}</a> : "10-K"} — its framing of its industry and rivals; a full picture cross-checks the competitors&apos; own filings. Named competitors are pulled verbatim from the filing; nothing is inferred or added from outside. Research, not advice.
      </p>
    </div>
  );
}

export default function CompanyBriefing({ symbol }: { symbol: string }) {
  const [data, setData] = useState<CompanyBriefing | null>(null);
  const [loading, setLoading] = useState(false);
  const inflight = useRef(false);

  const load = async () => {
    if (data || inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const r = await fetch(`/api/company-briefing/${encodeURIComponent(symbol)}`).then((x) => x.json());
      setData(r && typeof r === "object" ? r : null);
    } catch {
      setData({ symbol, source: null, whatItIs: null, howItMakesMoney: null, industry: null, competitivePosition: null, competitors: [], customers: null, suppliers: null, moats: [], risks: [], watchItems: [], note: "Couldn't load the briefing." });
    }
    setLoading(false);
  };

  if (!data) {
    return (
      <div className="py-1">
        <p className="mb-2 text-[12px] leading-relaxed text-[var(--text-3)]">
          Get up to speed fast: what this business does, how its industry works, who it competes with, and what to watch — drilled from its latest annual report (10-K).
        </p>
        <button onClick={load} disabled={loading} className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-[12px] text-[var(--text-2)] transition-colors hover:bg-[var(--surface-hover)] disabled:opacity-60">
          {loading ? "Reading the 10-K…" : "Show business briefing"}
        </button>
      </div>
    );
  }
  if (!briefingHasDetail(data)) return <div className="py-3 text-[12px] text-[var(--text-4)]">{data.note ?? "No 10-K briefing available for this filer (US filers only)."}</div>;
  return <div className="text-[12px]"><Body r={data} /></div>;
}
