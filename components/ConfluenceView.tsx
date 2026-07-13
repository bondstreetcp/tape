"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { SIGNAL_META, SIGNAL_ORDER, type ConfluenceData, type ConfluenceName, type FlaggedInfo, type SignalKind } from "@/lib/confluence";
import { UNIVERSE_BY_ID } from "@/lib/universes";

const money = (v: number | null) =>
  v == null ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(1)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`;
const pct = (v: number | null, d = 0) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const col = (v: number | null) => (v == null ? "var(--text-3)" : v >= 0 ? "#22c55e" : "#ef4444");
// Bare YYYY-MM-DD must render in UTC or US browsers show the prior day.
const day = (d: string) => new Date(d + "T00:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

export default function ConfluenceView({ data, universe, flagged }: { data: ConfluenceData; universe: string; flagged?: Record<string, FlaggedInfo> | null }) {
  const [filter, setFilter] = useState<SignalKind | null>(null);
  const names = useMemo(() => (filter ? data.names.filter((n) => n.kinds.includes(filter)) : data.names), [data.names, filter]);
  const asOf = data.generatedAt ? new Date(data.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
      <div className="mt-1" />
      <PageHeader
        universe={universe}
        title="Confluence Engine"
        desc="Names where several INDEPENDENT bullish signals line up — cheap vs its own 10-year history, super-investor 13F buying, Congress buys, a real buyback (shrinking share count), analyst upgrades, call-heavy options flow, catalysts. One signal is noise; a stack of unrelated ones agreeing is a setup worth a look. Decision-support, not advice."
      />

      {/* legend doubles as a filter */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {SIGNAL_ORDER.map((k) => {
          const m = SIGNAL_META[k];
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

      <div className="mb-3 text-xs text-[var(--text-4)]">
        {names.length} names · across the Russell 3000{asOf ? ` · as of ${asOf}` : ""} ·{" "}
        <Link href={`/u/${universe}/signal-record`} className="text-[var(--accent)] hover:underline" title="Board appearances are logged and graded on their 1w/1m/3m return vs the S&P">
          graded on the Track Record →
        </Link>
      </div>

      {names.length === 0 && (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">No names match right now — the board rebuilds on the nightly refresh.</div>
      )}
      <ul className="space-y-3">
        {names.map((n) => (
          <ConfluenceCard key={n.symbol} n={n} universe={universe} f={flagged?.[n.symbol]} />
        ))}
      </ul>
    </main>
  );
}

function ConfluenceCard({ n, universe, f }: { n: ConfluenceName; universe: string; f?: FlaggedInfo }) {
  // The accountability line: return since the Track Record first logged this stint on the board.
  const since = f && n.price != null && n.price > 0 && f.entryPrice > 0 ? (n.price / f.entryPrice - 1) * 100 : null;
  return (
    <li className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--border-strong)]">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
            <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-xs font-bold text-[var(--accent)]" title="Confluence score (weighted signal stack)">{n.score}</span>
            {f?.isNew && (
              <span className="rounded bg-[var(--accent)] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white" title="First appeared on the board on the latest tracked run">
                New
              </span>
            )}
            <Link href={`/u/${universe}/stock/${encodeURIComponent(n.symbol)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{n.symbol}</Link>
            <span className="truncate text-sm text-[var(--text-3)]">{n.name}</span>
          </div>
          <div className="mt-0.5 text-xs text-[var(--text-4)]">{n.sector || "—"} · {money(n.marketCap)}</div>
        </div>
        <div className="shrink-0 text-right text-xs">
          <div className="tabular-nums" style={{ color: col(n.retYtd) }}>{pct(n.retYtd)} <span className="text-[var(--text-4)]">YTD</span></div>
          <div className="tabular-nums text-[var(--text-3)]">{pct(n.pctFromHigh)} <span className="text-[var(--text-4)]">vs high</span></div>
          {f && since != null && (
            <div
              className="tabular-nums"
              style={{ color: col(since) }}
              title={(f.seed ? `On the board when tracking began (${day(f.date)})` : `Flagged ${day(f.date)} (this stint on the board)`) + " — raw price return since; the S&P-adjusted grade lives on the Track Record"}
            >
              {pct(since, 1)} <span className="text-[var(--text-4)]">since {day(f.date)}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {n.signals.map((s) => {
          const m = SIGNAL_META[s.kind];
          return (
            <span key={s.kind} className="rounded-full px-2 py-0.5 text-[11px] font-medium" style={{ background: `${m.color}22`, color: m.color }}>
              {s.label}
            </span>
          );
        })}
      </div>
      <ul className="mt-2 space-y-0.5">
        {n.signals.map((s) => (
          <li key={s.kind} className="text-[11px] leading-snug text-[var(--text-3)]">
            <span style={{ color: SIGNAL_META[s.kind].color }}>•</span> {s.detail}
          </li>
        ))}
      </ul>

      {n.read && (n.read.thesis || n.read.risk || n.read.watch) && (
        <div className="mt-3 space-y-1.5 border-t border-[var(--divider)] pt-3 text-[12px] leading-snug">
          {n.read.thesis && <p><span className="font-semibold text-[#22c55e]">Thesis </span><span className="text-[var(--text-2)]">{n.read.thesis}</span></p>}
          {n.read.risk && <p><span className="font-semibold text-[#ef4444]">Risk </span><span className="text-[var(--text-2)]">{n.read.risk}</span></p>}
          {n.read.watch && <p><span className="font-semibold text-[var(--accent)]">Watch </span><span className="text-[var(--text-2)]">{n.read.watch}</span></p>}
        </div>
      )}
    </li>
  );
}
