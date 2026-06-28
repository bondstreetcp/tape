"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { OvernightData, OvernightItem, Sentiment } from "@/lib/overnightFilings";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UniverseSwitcher from "./UniverseSwitcher";

// Form badge palette — 10-K/10-Q (periodic) vs 8-K (current report).
const formBadge = (form: string): string => {
  const f = form.replace("/A", "");
  if (f === "10-K") return "bg-[#7c3aed]/15 text-[#a78bfa]";
  if (f === "10-Q") return "bg-[#2563eb]/15 text-[#60a5fa]";
  return "bg-[#0891b2]/15 text-[#22d3ee]"; // 8-K
};

const sentChip: Record<Sentiment, { cls: string; label: string }> = {
  bullish: { cls: "bg-[#22c55e]/15 text-[#22c55e]", label: "Bullish" },
  bearish: { cls: "bg-[#ef4444]/15 text-[#ef4444]", label: "Bearish" },
  neutral: { cls: "bg-[var(--surface-hover)] text-[var(--text-3)]", label: "Neutral" },
};

const surpriseChip: Record<string, { cls: string; label: string }> = {
  beat: { cls: "bg-[#22c55e]/15 text-[#22c55e]", label: "Beat" },
  miss: { cls: "bg-[#ef4444]/15 text-[#ef4444]", label: "Miss" },
  inline: { cls: "bg-[var(--surface-hover)] text-[var(--text-3)]", label: "In-line" },
  na: { cls: "", label: "" },
};

const fmtTime = (iso: string): string => {
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return "";
  return new Date(ms).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};

type FormFilter = "all" | "8-K" | "10-Q" | "10-K";
type SentFilter = "all" | Sentiment;

export default function OvernightFilingsView({ universe, data, known }: { universe: string; data: OvernightData; known: string[] }) {
  const knownSet = useMemo(() => new Set(known), [known]);
  const [formF, setFormF] = useState<FormFilter>("all");
  const [sentF, setSentF] = useState<SentFilter>("all");

  // Universe filter: the digest is built across all US large-caps, but only show filings
  // for names that belong to the currently-selected universe.
  const universeItems = useMemo(() => data.items.filter((it) => knownSet.has(it.ticker)), [data.items, knownSet]);
  const rows = useMemo(
    () =>
      universeItems.filter((it) => {
        if (formF !== "all" && it.form.replace("/A", "") !== formF) return false;
        if (sentF !== "all" && it.sentiment !== sentF) return false;
        return true;
      }),
    [universeItems, formF, sentF],
  );
  // Honest window label — the effective lookback reaches back to the previous trading
  // session, which is wider than a flat 36h after a weekend, so show the actual date.
  const sinceLabel = useMemo(() => {
    const ms = Date.parse(data.since);
    return Number.isFinite(ms) ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : "";
  }, [data.since]);

  const tlink = (ticker: string) =>
    knownSet.has(ticker) ? (
      <Link href={`/u/${universe}/stock/${encodeURIComponent(ticker)}`} className="font-mono text-base font-bold text-[#60a5fa] hover:underline">{ticker}</Link>
    ) : (
      <span className="font-mono text-base font-bold text-[var(--text-2)]">{ticker}</span>
    );

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[#2563eb] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[72rem] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Overnight Filings</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--text-3)]">
            AI-summarized new SEC filings vs the prior comparable — spot-check against the source. {universeItems.length} filing{universeItems.length !== 1 ? "s" : ""}{sinceLabel ? ` since ${sinceLabel}` : ""} · source <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent" target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">SEC EDGAR</a>
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {/* filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {(["all", "8-K", "10-Q", "10-K"] as FormFilter[]).map((f) => (
            <button key={f} onClick={() => setFormF(f)} className={TB(formF === f)}>{f === "all" ? "All forms" : f}</button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {(["all", "bullish", "neutral", "bearish"] as SentFilter[]).map((s) => (
            <button key={s} onClick={() => setSentF(s)} className={TB(sentF === s)}>{s === "all" ? "All" : sentChip[s as Sentiment].label}</button>
          ))}
        </div>
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} shown</span>
      </div>

      {/* feed */}
      {universeItems.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-16 text-center text-sm text-[var(--text-3)]">
          No new material filings{sinceLabel ? ` since ${sinceLabel}` : " in the last 36 hours"}{data.items.length > 0 ? " for this universe" : ""}. Check back after the next overnight run.
        </div>
      ) : rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-12 text-center text-sm text-[var(--text-3)]">No filings match these filters.</div>
      ) : (
        <div className="space-y-3">
          {rows.map((it) => (
            <Card key={it.accession} it={it} tlink={tlink} />
          ))}
        </div>
      )}

      <p className="mt-4 text-[11px] text-[var(--text-4)]">
        Each note is generated by an AI model from the filing&apos;s text and the prior comparable filing of the same type — it can misread or omit. Treat it as a triage pointer, not a substitute for reading the filing. Not investment advice.
      </p>
    </main>
  );
}

function Card({ it, tlink }: { it: OvernightItem; tlink: (t: string) => React.ReactNode }) {
  const sent = sentChip[it.sentiment] ?? sentChip.neutral;
  const surp = surpriseChip[it.surprise];
  const metrics = Object.entries(it.keyMetrics || {}).filter(([, v]) => v != null && String(v).trim());
  const isPeriodic = it.form.replace("/A", "") === "10-K" || it.form.replace("/A", "") === "10-Q";

  return (
    <article className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-[var(--divider)] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          {tlink(it.ticker)}
          <span className="max-w-[14rem] truncate text-sm text-[var(--text-3)]">{it.name}</span>
          <span className={"rounded px-1.5 py-0.5 text-[10px] font-semibold " + formBadge(it.form)}>{it.form}</span>
        </div>
        <div className="flex items-center gap-2 text-xs tabular-nums text-[var(--text-4)]">
          <span title={it.filedAt}>{fmtTime(it.filedAt)}</span>
          <a href={it.url} target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">EDGAR →</a>
        </div>
      </div>

      <div className="px-4 py-3">
        <h2 className="text-[15px] font-semibold leading-snug text-[var(--text)]">{it.headline}</h2>

        <div className="mt-2 flex flex-wrap items-center gap-1.5">
          <span className={"rounded px-1.5 py-0.5 text-[10px] font-semibold " + sent.cls}>{sent.label}</span>
          {surp && surp.label && <span className={"rounded px-1.5 py-0.5 text-[10px] font-semibold " + surp.cls}>{surp.label}</span>}
          {isPeriodic && (it.riskFactorsAdded != null || it.riskFactorsRemoved != null) && (
            <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-medium tabular-nums text-[var(--text-3)]" title="Machine-diffed risk-factor sentences vs the prior comparable">
              Risk factors <span className="text-[#22c55e]">+{it.riskFactorsAdded ?? 0}</span> / <span className="text-[#ef4444]">−{it.riskFactorsRemoved ?? 0}</span>
            </span>
          )}
        </div>

        {it.whatChanged.length > 0 && (
          <ul className="mt-3 space-y-1">
            {it.whatChanged.map((w, i) => (
              <li key={i} className="flex gap-2 text-sm text-[var(--text-2)]">
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-[var(--text-4)]" aria-hidden />
                <span className="leading-snug">{w}</span>
              </li>
            ))}
          </ul>
        )}

        {it.decisionTakeaway && (
          <p className="mt-3 border-l-2 border-[#2563eb]/50 pl-3 text-sm italic leading-snug text-[var(--text-2)]">{it.decisionTakeaway}</p>
        )}

        {metrics.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {metrics.slice(0, 8).map(([k, v]) => (
              <span key={k} className="rounded bg-[var(--bg)] px-2 py-0.5 text-[11px] tabular-nums text-[var(--text-3)]">
                <span className="text-[var(--text-4)]">{k}:</span> <span className="text-[var(--text-2)]">{String(v)}</span>
              </span>
            ))}
          </div>
        )}
      </div>
    </article>
  );
}
