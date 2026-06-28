"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import InfoDot from "./InfoDot";
import { SCREEN_SHORT, SCREEN_INFO, SCREEN_ORDER, type ScreenKey } from "@/lib/screens";
import type { FactorOverlapName } from "@/lib/factorOverlap";
import { UNIVERSE_BY_ID } from "@/lib/universes";

const money = (v: number | null) =>
  v == null ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(1)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`;
const pct = (v: number | null, d = 0) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const col = (v: number | null) => (v == null ? "var(--text-3)" : v >= 0 ? "#22c55e" : "#ef4444");

export default function FactorOverlapView({ names, universe }: { names: FactorOverlapName[]; universe: string }) {
  const [minCount, setMinCount] = useState(2);
  const [screenFilter, setScreenFilter] = useState<ScreenKey | null>(null);
  const rows = useMemo(
    () => names.filter((n) => n.count >= minCount && (!screenFilter || n.screens.some((s) => s.key === screenFilter))).slice(0, 120),
    [names, minCount, screenFilter],
  );
  const maxCount = names[0]?.count ?? 0;

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
      <div className="mt-1" />
      <PageHeader
        title="Factor-Screen Overlap"
        desc="Names that land in the top of MULTIPLE classic value/quality screens at once — cheap AND high-quality AND improving AND returning cash. A single screen can miss the best all-round profiles; the overlap surfaces them. Decision-support, not advice."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <span className="text-xs text-[var(--text-4)]">Passes ≥</span>
        {[2, 3, 4].filter((n) => n <= Math.max(2, maxCount)).map((n) => (
          <button key={n} onClick={() => setMinCount(n)} className={"rounded-md px-2 py-0.5 text-xs font-medium transition-colors " + (minCount === n ? "bg-[var(--accent-strong)] text-white" : "border border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)]")}>{n}</button>
        ))}
        <span className="ml-2 text-xs text-[var(--text-4)]">screens · filter by lens:</span>
        {SCREEN_ORDER.map((k) => (
          <button key={k} onClick={() => setScreenFilter(screenFilter === k ? null : k)} title={SCREEN_INFO[k].what}
            className={"rounded-full px-2 py-0.5 text-[11px] font-medium transition-colors " + (screenFilter === k ? "bg-[var(--accent)] text-white" : "border border-[var(--border)] text-[var(--text-3)] hover:border-[var(--border-strong)]")}>
            {SCREEN_SHORT[k]}
          </button>
        ))}
        {screenFilter && <button onClick={() => setScreenFilter(null)} className="text-xs text-[var(--text-3)] underline hover:text-[var(--text)]">clear</button>}
      </div>

      <div className="mb-3 text-xs text-[var(--text-4)]">{rows.length} names · {UNIVERSE_BY_ID[universe]?.name ?? universe} · top 50 of each of the 9 screens</div>

      <ul className="space-y-2.5">
        {rows.map((n) => (
          <li key={n.symbol} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--border-strong)]">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 font-mono text-xs font-bold text-[var(--accent)]" title="Number of screens it lands in">{n.count}×</span>
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(n.symbol)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{n.symbol}</Link>
                  <span className="truncate text-sm text-[var(--text-3)]">{n.name}</span>
                </div>
                <div className="mt-0.5 text-xs text-[var(--text-4)]">{n.sector || "—"} · {money(n.marketCap)}{n.trailingPE ? ` · P/E ${n.trailingPE.toFixed(0)}` : ""}</div>
              </div>
              <div className="shrink-0 text-right text-xs tabular-nums" style={{ color: col(n.retYtd) }}>{pct(n.retYtd)} <span className="text-[var(--text-4)]">YTD</span></div>
            </div>
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {n.screens.map((s) => (
                <span key={s.key} title={`${SCREEN_INFO[s.key].name} — #${s.rank + 1}`} className="rounded-full bg-[var(--surface-hover)] px-2 py-0.5 text-[11px] font-medium text-[var(--text-2)]">
                  {SCREEN_SHORT[s.key]} <span className="text-[var(--text-4)]">#{s.rank + 1}</span>
                </span>
              ))}
            </div>
          </li>
        ))}
      </ul>
      {!rows.length && <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">No names overlap at that threshold — lower it, or try a broader universe.</div>}
    </main>
  );
}
