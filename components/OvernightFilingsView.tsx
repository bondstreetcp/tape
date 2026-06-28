"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { OvernightData, OvernightItem, Sentiment } from "@/lib/overnightFilings";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import UniverseSwitcher from "./UniverseSwitcher";

// Form badge palette — periodic (10-K/10-Q) · current report (8-K) · M&A (S-4/425) ·
// offering (424B).
const formBadge = (form: string): string => {
  const f = form.replace("/A", "");
  if (f === "10-K") return "bg-[#7c3aed]/15 text-[#a78bfa]";
  if (f === "10-Q") return "bg-[#2563eb]/15 text-[var(--accent)]";
  if (f === "S-4" || f === "425") return "bg-[#f59e0b]/15 text-[#fbbf24]"; // M&A — amber
  if (/^424B/.test(f)) return "bg-[#22c55e]/15 text-[#4ade80]"; // offering — green
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

type FormFilter = "all" | "8-K" | "10-Q" | "10-K" | "deals";
type SentFilter = "all" | Sentiment;
const FORM_TABS: { k: FormFilter; label: string }[] = [
  { k: "all", label: "All forms" },
  { k: "8-K", label: "8-K" },
  { k: "10-Q", label: "10-Q" },
  { k: "10-K", label: "10-K" },
  { k: "deals", label: "M&A / Offering" },
];
const isDeal = (form: string) => /^(S-4|425|424B)/.test(form.replace("/A", ""));

// A high-impact (market-moving) filing gets a red/green flag from impact × sentiment.
function impactFlag(it: OvernightItem): { cls: string; label: string; border: string } | null {
  if (it.impact !== "high") return null;
  if (it.sentiment === "bullish") return { cls: "bg-[#22c55e]/20 text-[#22c55e]", label: "Green flag", border: "border-l-[#22c55e]" };
  if (it.sentiment === "bearish") return { cls: "bg-[#ef4444]/20 text-[#ef4444]", label: "Red flag", border: "border-l-[#ef4444]" };
  return { cls: "bg-[#f59e0b]/20 text-[#fbbf24]", label: "Notable", border: "border-l-[#f59e0b]" };
}

export default function OvernightFilingsView({ universe, data, known, sectors = {} }: { universe: string; data: OvernightData; known: string[]; sectors?: Record<string, string> }) {
  const knownSet = useMemo(() => new Set(known), [known]);
  const [formF, setFormF] = useState<FormFilter>("all");
  const [sentF, setSentF] = useState<SentFilter>("all");
  const [sectorF, setSectorF] = useState<string>("all");
  const [moversOnly, setMoversOnly] = useState(false);
  const [q, setQ] = useState("");

  // Universe filter: the digest is built across all US large-caps, but only show filings
  // for names that belong to the currently-selected universe.
  const universeItems = useMemo(() => data.items.filter((it) => knownSet.has(it.ticker)), [data.items, knownSet]);
  // Sectors present in this universe's filings (for the dropdown).
  const sectorOpts = useMemo(() => {
    const s = new Set<string>();
    for (const it of universeItems) { const sec = sectors[it.ticker]; if (sec) s.add(sec); }
    return [...s].sort();
  }, [universeItems, sectors]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const out = universeItems.filter((it) => {
      if (moversOnly && it.impact !== "high") return false;
      if (formF !== "all") {
        const f = it.form.replace("/A", "");
        if (formF === "deals" ? !isDeal(f) : f !== formF) return false;
      }
      if (sentF !== "all" && it.sentiment !== sentF) return false;
      if (sectorF !== "all" && (sectors[it.ticker] || "") !== sectorF) return false;
      if (needle && !`${it.ticker} ${it.name} ${it.headline}`.toLowerCase().includes(needle)) return false;
      return true;
    });
    // Surface the market-movers: high-impact first, then (stable) newest-first within a tier.
    const rank = (i: OvernightItem) => (i.impact === "high" ? 0 : i.impact === "medium" ? 1 : 2);
    return out.sort((a, b) => rank(a) - rank(b));
  }, [universeItems, formF, sentF, sectorF, moversOnly, q, sectors]);
  const filtered = rows.length !== universeItems.length;
  const moverCount = useMemo(() => universeItems.filter((it) => it.impact === "high").length, [universeItems]);
  // Honest window label — the effective lookback reaches back to the previous trading
  // session, which is wider than a flat 36h after a weekend, so show the actual date.
  const sinceLabel = useMemo(() => {
    const ms = Date.parse(data.since);
    return Number.isFinite(ms) ? new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" }) : "";
  }, [data.since]);

  const tlink = (ticker: string) =>
    knownSet.has(ticker) ? (
      <Link href={`/u/${universe}/stock/${encodeURIComponent(ticker)}`} className="font-mono text-base font-bold text-[var(--accent)] hover:underline">{ticker}</Link>
    ) : (
      <span className="font-mono text-base font-bold text-[var(--text-2)]">{ticker}</span>
    );

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[72rem] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Overnight Filings</h1>
          <p className="mt-1 max-w-3xl text-xs text-[var(--text-3)]">
            AI-summarized new SEC filings vs the prior comparable — spot-check against the source. {universeItems.length} filing{universeItems.length !== 1 ? "s" : ""}{sinceLabel ? ` since ${sinceLabel}` : ""} · source <a href="https://www.sec.gov/cgi-bin/browse-edgar?action=getcurrent" target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">SEC EDGAR</a>
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      {/* filters */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search ticker, name, headline…"
          className="w-52 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text)] outline-none placeholder:text-[var(--text-4)] focus:border-[var(--border-strong)]"
        />
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {FORM_TABS.map(({ k, label }) => (
            <button key={k} onClick={() => setFormF(k)} className={TB(formF === k)}>{label}</button>
          ))}
        </div>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {(["all", "bullish", "neutral", "bearish"] as SentFilter[]).map((s) => (
            <button key={s} onClick={() => setSentF(s)} className={TB(sentF === s)}>{s === "all" ? "All" : sentChip[s as Sentiment].label}</button>
          ))}
        </div>
        {sectorOpts.length > 1 && (
          <select
            value={sectorF}
            onChange={(e) => setSectorF(e.target.value)}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
          >
            <option value="all">All sectors</option>
            {sectorOpts.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        )}
        <button
          onClick={() => setMoversOnly((v) => !v)}
          disabled={moverCount === 0}
          title="Show only filings the AI flagged as market-moving (high impact)"
          className={"rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 " + (moversOnly ? "border-[#f59e0b] bg-[#f59e0b]/15 text-[#fbbf24]" : "border-[var(--border)] bg-[var(--bg)] text-[var(--text-3)] hover:text-[var(--text)]")}
        >
          ⚡ Movers{moverCount ? ` ${moverCount}` : ""}
        </button>
        <span className="ml-auto flex items-center gap-2 text-xs text-[var(--text-4)]">
          {filtered && (
            <button onClick={() => { setFormF("all"); setSentF("all"); setSectorF("all"); setMoversOnly(false); setQ(""); }} className="text-[var(--accent)] hover:underline">clear</button>
          )}
          {rows.length} shown
        </span>
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
  const flag = impactFlag(it);
  const metrics = Object.entries(it.keyMetrics || {}).filter(([, v]) => v != null && String(v).trim());
  const isPeriodic = it.form.replace("/A", "") === "10-K" || it.form.replace("/A", "") === "10-Q";

  return (
    <article className={"overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)] " + (flag ? "border-l-2 " + flag.border : "")}>
      <div className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 border-b border-[var(--divider)] px-4 py-2.5">
        <div className="flex items-center gap-2.5">
          {tlink(it.ticker)}
          <span className="max-w-[14rem] truncate text-sm text-[var(--text-3)]">{it.name}</span>
          <span className={"rounded px-1.5 py-0.5 text-[10px] font-semibold " + formBadge(it.form)}>{it.form}</span>
          {flag && <span className={"rounded px-1.5 py-0.5 text-[10px] font-bold " + flag.cls}>{flag.label}</span>}
        </div>
        <div className="flex items-center gap-2 text-xs tabular-nums text-[var(--text-4)]">
          <span title={it.filedAt}>{fmtTime(it.filedAt)}</span>
          <a href={it.url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">EDGAR →</a>
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
