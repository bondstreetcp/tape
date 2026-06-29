"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { InsidersData } from "@/lib/insiders";

const money = (v: number | null) =>
  v == null ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `$${(v / 1e3).toFixed(0)}k` : `$${Math.round(v)}`;
const signed = (v: number | null, d = 0) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);

export default function InsidersView({ data, universe }: { data: InsidersData; universe: string }) {
  const uname = UNIVERSE_BY_ID[universe]?.name ?? universe;
  const [clusterOnly, setClusterOnly] = useState(false);

  const rows = useMemo(() => data.rows.filter((r) => !clusterOnly || r.buyers >= 2).slice(0, 120), [data.rows, clusterOnly]);
  const clusters = useMemo(() => data.rows.filter((r) => r.buyers >= 2).length, [data.rows]);

  return (
    <main className="mx-auto max-w-4xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {uname}</Link>
      <div className="mt-1" />
      <PageHeader
        title="Insider Cluster-Buying"
        desc={`Open-market insider BUYS (SEC Form 4, code P) over the last ${data.windowDays} days — corporate insiders putting their own cash in, especially on weakness, is a high-conviction accumulation tell. Cluster buys (several insiders, or large $) rank highest. Open-market buying is RARE in mega-caps, so this is far richer on broad / small-cap universes. Decision-support, not advice.`}
      />

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setClusterOnly((v) => !v)}
          className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (clusterOnly ? "bg-[var(--accent-strong)] text-white" : "border border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)]")}
        >
          ⊕ Clusters only ({clusters})
        </button>
        {clusterOnly && <button onClick={() => setClusterOnly(false)} className="text-xs text-[var(--text-3)] underline hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} of {data.coverage} buying · {uname}</span>
      </div>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-3)]">No open-market insider buys in {uname} in the window. Try a broad / small-cap universe (Broad 1500 or Russell 3000).</div>
      ) : (
        <ul className="space-y-2.5">
          {rows.map((r) => (
            <li key={r.symbol} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--border-strong)]">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                    {r.buyers >= 2 && <span className="rounded bg-[#22c55e1a] px-1.5 py-0.5 font-mono text-xs font-bold text-[#22c55e]" title="Distinct insiders buying">{r.buyers}× buyers</span>}
                    <Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{r.symbol}</Link>
                    <span className="truncate text-sm text-[var(--text-3)]">{r.name}</span>
                    <span className="text-[10px] text-[var(--text-4)]">{r.sector}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--text-4)]">
                    <span className="font-semibold text-[#22c55e]">{money(r.totalValue)}</span> bought
                    {" · "}latest {r.lastBuy}{r.daysSince != null && ` (${r.daysSince}d ago)`}
                    {" · "}<span style={{ color: r.pctFromHigh <= -15 ? "#f59e0b" : "var(--text-4)" }} title="Distance from 52-week high — buying on weakness is higher-conviction">{signed(r.pctFromHigh)} off 52wH</span>
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <div className="text-[10px] text-[var(--text-4)]">cluster</div>
                  <div className="font-mono text-sm font-bold tabular-nums text-[var(--text-2)]">{r.clusterScore}</div>
                </div>
              </div>
              {r.top.length > 0 && (
                <ul className="mt-2 space-y-0.5 border-t border-[var(--divider)] pt-2">
                  {r.top.slice(0, 4).map((b, i) => (
                    <li key={i} className="flex items-baseline justify-between gap-2 text-[11px]">
                      <span className="min-w-0 truncate text-[var(--text-2)]">{b.insider}<span className="text-[var(--text-4)]"> · {b.role}</span></span>
                      <span className="shrink-0 tabular-nums text-[var(--text-3)]">{b.shares ? b.shares.toLocaleString() : "—"} {b.price ? `@ $${b.price.toFixed(2)}` : ""} <span className="font-medium text-[#22c55e]">{money(b.value)}</span> · {b.date}</span>
                    </li>
                  ))}
                </ul>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="mt-3 text-[11px] text-[var(--text-4)]">Cluster score = blended percentile of # distinct buyers (50%), $ bought ÷ market cap (30%) and recency (20%). SEC Form 4 open-market purchases (code P) via data/insiders.json{data.asOf ? ` · as of ${data.asOf}` : ""}. Not investment advice.</p>
    </main>
  );
}
