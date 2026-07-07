"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import HowToRead from "./HowToRead";
import { WARNING_META, WARNING_ORDER, type WarningsData, type WarningName, type WarningKind } from "@/lib/warnings";
import { UNIVERSE_BY_ID } from "@/lib/universes";

const money = (v: number | null) =>
  v == null ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(1)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`;
const pct = (v: number | null, d = 0) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const col = (v: number | null) => (v == null ? "var(--text-3)" : v >= 0 ? "#22c55e" : "#ef4444");

export default function WarningsView({ data, universe }: { data: WarningsData; universe: string }) {
  const [filter, setFilter] = useState<WarningKind | null>(null);
  const names = useMemo(() => (filter ? data.names.filter((n) => n.kinds.includes(filter)) : data.names), [data.names, filter]);
  const asOf = data.generatedAt ? new Date(data.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}/confluence`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← Confluence Engine</Link>
      <div className="mt-1" />
      <PageHeader
        universe={universe}
        title="Warning Signs"
        desc="The bearish twin of the Confluence Engine — names where several INDEPENDENT negative signals line up: rich vs its own 10-year history, EPS estimates being cut, super-investor 13F exits, a guidance cut, an analyst downgrade, put-heavy flow. A stack of unrelated bear signals on a name still priced for perfection is a value-trap / short-candidate flag worth a look. Decision-support, not advice."
      />

      <HowToRead>
        <p><b>What this is:</b> the inverse of the Confluence Engine. Where that board finds names several bullish signals agree on, this finds names several <i>bearish</i> ones do — the risk lens.</p>
        <p><b>The signals</b> are independent by construction: valuation (rich vs the name&apos;s own 10-yr history), the Street cutting EPS, super-investors exiting (13F), management cutting guidance, a sell-side downgrade, and put-heavy options flow. A name needs <b>2+ to appear</b>, so it&apos;s a stack, not a lone flag.</p>
        <p><b>Why "priced for perfection" matters:</b> the sharpest warnings pair the <b style={{ color: "#ef4444" }}>Expensive</b> signal with deteriorating fundamentals — a name that&apos;s still richly valued <i>while</i> estimates fall and informed money leaves. A cheap name with a downgrade is often just noise.</p>
        <p><b>Caveat:</b> this is a "reasons for caution stacking up" board, not a short list — each signal has innocent explanations, and shorting rich names that keep working is how books blow up. Investigate, don&apos;t act blindly. Not advice.</p>
      </HowToRead>

      {/* legend doubles as a filter */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {WARNING_ORDER.map((k) => {
          const m = WARNING_META[k];
          const active = filter === k;
          return (
            <button
              key={k}
              onClick={() => setFilter(active ? null : k)}
              title={m.blurb}
              className={"flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors " + (active ? "border-transparent text-white" : "border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)]")}
              style={active ? { background: m.color } : undefined}
            >
              <span className="h-2 w-2 rounded-full" style={{ background: active ? "#fff" : m.color }} />
              {m.label} <span className="opacity-60">{data.counts[k] ?? 0}</span>
            </button>
          );
        })}
        {filter && <button onClick={() => setFilter(null)} className="text-xs text-[var(--text-3)] underline hover:text-[var(--text)]">clear</button>}
      </div>

      <div className="mb-3 text-xs text-[var(--text-4)]">{names.length} names · across the Russell 3000{asOf ? ` · as of ${asOf}` : ""}</div>

      {names.length === 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">No names match right now — the board rebuilds on the nightly refresh.</div>
      )}
      <ul className="space-y-3">
        {names.map((n) => <WarningCard key={n.symbol} n={n} universe={universe} />)}
      </ul>
    </main>
  );
}

function WarningCard({ n, universe }: { n: WarningName; universe: string }) {
  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--border-strong)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="rounded bg-[color-mix(in_oklab,#ef4444_16%,transparent)] px-1.5 py-0.5 font-mono text-xs font-bold text-[#ef4444]" title="Warning score (weighted bear-signal stack)">{n.score}</span>
            <Link href={`/u/${universe}/stock/${encodeURIComponent(n.symbol)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{n.symbol}</Link>
            <span className="truncate text-sm text-[var(--text-3)]">{n.name}</span>
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-4)]">{n.sector || "—"} · {money(n.marketCap)}</div>
        </div>
        <div className="shrink-0 text-right text-xs">
          <div className="tabular-nums" style={{ color: col(n.retYtd) }}>{pct(n.retYtd)} <span className="text-[var(--text-4)]">YTD</span></div>
          <div className="tabular-nums text-[var(--text-3)]">{pct(n.pctFromHigh)} <span className="text-[var(--text-4)]">vs high</span></div>
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {n.signals.map((s) => {
          const m = WARNING_META[s.kind];
          return <span key={s.kind} className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `${m.color}22`, color: m.color }}>{s.label}</span>;
        })}
      </div>
      <ul className="mt-2 space-y-0.5">
        {n.signals.map((s) => (
          <li key={s.kind} className="text-[11px] leading-snug text-[var(--text-3)]"><span style={{ color: WARNING_META[s.kind].color }}>•</span> {s.detail}</li>
        ))}
      </ul>

      {n.read && (n.read.thesis || n.read.risk || n.read.watch) && (
        <div className="mt-3 space-y-1.5 border-t border-[var(--divider)] pt-3 text-[12px] leading-snug">
          {n.read.thesis && <p><span className="font-semibold text-[#ef4444]">Bear case </span><span className="text-[var(--text-2)]">{n.read.thesis}</span></p>}
          {n.read.risk && <p><span className="font-semibold text-[#22c55e]">What invalidates it </span><span className="text-[var(--text-2)]">{n.read.risk}</span></p>}
          {n.read.watch && <p><span className="font-semibold text-[var(--accent)]">Watch </span><span className="text-[var(--text-2)]">{n.read.watch}</span></p>}
        </div>
      )}
    </li>
  );
}
