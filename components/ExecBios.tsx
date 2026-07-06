"use client";
import { useState, useRef } from "react";
import type { Officer } from "@/lib/companyProfile";
import { type ExecBio, type ExecBiosResponse, bioHasDetail } from "@/lib/execBios";
import { currencyPrefix } from "@/lib/format";

// The "Key Executives" roster with a click-to-expand bio drilled from the company's SEC filings (grounded
// on-demand via /api/exec-bios). Bios lazy-load on the first click, so a profile view costs nothing until
// the user actually asks for a background.

const money = (n: number, cur: string): string => {
  const p = currencyPrefix(cur);
  return n >= 1e9 ? `${p}${(n / 1e9).toFixed(2)}B` : n >= 1e6 ? `${p}${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${p}${(n / 1e3).toFixed(0)}K` : `${p}${n.toFixed(0)}`;
};
const lastName = (n: string) => n.trim().split(/\s+/).slice(-1)[0];

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex gap-2">
      <span className="w-20 shrink-0 text-[11px] uppercase tracking-wide text-[var(--text-4)]">{label}</span>
      <span className="flex-1 text-[var(--text-2)]">{children}</span>
    </div>
  );
}

function BioBody({ bio, proxy }: { bio: ExecBio; proxy: { url: string; date: string } | null }) {
  return (
    <div className="space-y-1.5">
      {bio.summary && <p className="text-[var(--text-2)]">{bio.summary}</p>}
      {bio.since != null && <Line label="In role">since {bio.since}</Line>}
      {bio.priorRoles.length > 0 && <Line label="Previously"><ul className="list-disc space-y-0.5 pl-4">{bio.priorRoles.map((r, i) => <li key={i}>{r}</li>)}</ul></Line>}
      {bio.education.length > 0 && <Line label="Education">{bio.education.join(" · ")}</Line>}
      {bio.otherBoards.length > 0 && <Line label="Other boards">{bio.otherBoards.join(" · ")}</Line>}
      {proxy && <a href={proxy.url} target="_blank" rel="noreferrer" className="inline-block pt-0.5 text-[11px] text-[var(--accent)] hover:underline">source: {proxy.date} proxy →</a>}
    </div>
  );
}

export default function ExecBios({ symbol, officers, currency = "USD" }: { symbol: string; officers: Officer[]; currency?: string }) {
  const [data, setData] = useState<ExecBiosResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const inflight = useRef(false); // synchronous guard — two fast clicks both read stale `loading` state

  const load = async () => {
    if (data || inflight.current) return;
    inflight.current = true;
    setLoading(true);
    try {
      const r = await fetch(`/api/exec-bios/${encodeURIComponent(symbol)}`).then((x) => x.json());
      setData(r && typeof r === "object" ? r : { symbol, proxy: null, bios: {} });
    } catch { setData({ symbol, proxy: null, bios: {}, note: "Couldn't load bios." }); }
    setLoading(false);
  };
  const toggle = (name: string) => { setOpen((cur) => (cur === name ? null : name)); load(); };

  if (!officers.length) return <div className="py-4 text-center text-[12px] text-[var(--text-4)]">No executives listed.</div>;

  return (
    <div>
      <div className="divide-y divide-[var(--divider)]">
        {officers.map((o, i) => {
          const isOpen = open === o.name;
          const bio = data?.bios?.[o.name];
          return (
            <div key={i}>
              <button
                onClick={() => toggle(o.name)}
                aria-expanded={isOpen}
                className="-mx-1 flex w-full items-baseline justify-between gap-2 rounded px-1 py-1.5 text-left transition-colors hover:bg-[var(--surface-hover)]"
              >
                <span className="text-sm">
                  <span className="text-[var(--text)]">{o.name}</span>
                  <span className="ml-1.5 text-xs text-[var(--text-3)]">· {o.title}</span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {o.pay ? <span className="text-sm tabular-nums text-[var(--text-2)]">{money(o.pay, currency)}</span> : null}
                  <span className="text-[10px] text-[var(--text-4)]">{isOpen ? "▲" : "▼"}</span>
                </span>
              </button>
              {isOpen && (
                <div className="mb-2 mt-0.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-[12px] leading-relaxed">
                  {loading && !data ? (
                    <span className="text-[var(--text-4)]">Reading {o.name.split(/\s+/)[0]}&apos;s bio from the latest SEC filings…</span>
                  ) : bioHasDetail(bio) ? (
                    <BioBody bio={bio!} proxy={data?.proxy ?? null} />
                  ) : (
                    <span className="text-[var(--text-4)]">No background disclosed for {lastName(o.name)} in the latest proxy / 10-K.</span>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-4)]">
        Click a name for their background — extracted from the company&apos;s SEC proxy (DEF 14A) + 10-K, and left blank where the filing doesn&apos;t disclose it (nothing is inferred). Pay is the most recently reported total annual compensation.
      </p>
    </div>
  );
}
