"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { QUADRANTS, QUADRANT_META, type LeaderRow, type Quadrant } from "@/lib/leaders";

const money = (v: number | null) =>
  v == null ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(1)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`;
const pct = (v: number | null, d = 0) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);
const col = (v: number | null) => (v == null ? "var(--text-3)" : v >= 0 ? "#22c55e" : "#ef4444");

export default function LeadersView({ rows, universe }: { rows: LeaderRow[]; universe: string }) {
  const [quad, setQuad] = useState<Quadrant | null>(null);
  const [sector, setSector] = useState<string | null>(null);
  const [breakoutOnly, setBreakoutOnly] = useState(false);

  const sectors = useMemo(() => Array.from(new Set(rows.map((r) => r.sector).filter(Boolean))).sort(), [rows]);
  const counts = useMemo(() => {
    const c: Record<Quadrant, number> = { Leading: 0, Improving: 0, Weakening: 0, Lagging: 0 };
    for (const r of rows) c[r.quadrant]++;
    return c;
  }, [rows]);
  const breakoutCount = useMemo(() => rows.filter((r) => r.breakout).length, [rows]);

  const filtered = useMemo(
    () => rows.filter((r) => (!quad || r.quadrant === quad) && (!sector || r.sector === sector) && (!breakoutOnly || r.breakout)).slice(0, 150),
    [rows, quad, sector, breakoutOnly],
  );

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
      <div className="mt-1" />
      <PageHeader
        title="Leaders Board"
        desc="Every name ranked by relative strength (RS) — its multi-timeframe return percentile vs the rest of the universe (1–99, IBD-style) — and placed in a momentum quadrant from its RS level vs. whether that RS is accelerating. Breakout = near a 52-week high AND in a golden cross above the 200-day MA. Decision-support, not advice."
      />

      {/* Quadrant breadth strip — is leadership broad or narrow? */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {QUADRANTS.map((q) => (
          <button
            key={q}
            onClick={() => setQuad(quad === q ? null : q)}
            title={QUADRANT_META[q].blurb}
            className={"rounded-xl border p-3 text-left transition-colors " + (quad === q ? "border-[var(--border-strong)] bg-[var(--surface-hover)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]")}
          >
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: QUADRANT_META[q].color }} />
              <span className="text-xs font-semibold text-[var(--text-2)]">{q}</span>
            </div>
            <div className="mt-1 text-xl font-bold tabular-nums text-[var(--text)]">{counts[q]}</div>
            <div className="text-[10px] leading-tight text-[var(--text-4)]">{QUADRANT_META[q].blurb}</div>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <button
          onClick={() => setBreakoutOnly((v) => !v)}
          className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (breakoutOnly ? "bg-[var(--accent-strong)] text-white" : "border border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)]")}
        >
          🚀 Breakouts ({breakoutCount})
        </button>
        <select
          value={sector ?? ""}
          onChange={(e) => setSector(e.target.value || null)}
          className="rounded-md border border-[var(--border)] bg-[var(--surface)] px-2 py-1 text-xs text-[var(--text-2)]"
        >
          <option value="">All sectors</option>
          {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        {(quad || sector || breakoutOnly) && (
          <button onClick={() => { setQuad(null); setSector(null); setBreakoutOnly(false); }} className="text-xs text-[var(--text-3)] underline hover:text-[var(--text)]">clear</button>
        )}
        <span className="ml-auto text-xs text-[var(--text-4)]">{filtered.length} names · {UNIVERSE_BY_ID[universe]?.name ?? universe}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[680px] text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[var(--text-3)]">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-2 py-2 text-right font-medium">RS</th>
              <th className="px-2 py-2 font-medium">Trend</th>
              <th className="px-2 py-2 text-right font-medium">3M</th>
              <th className="px-2 py-2 text-right font-medium">6M</th>
              <th className="px-2 py-2 text-right font-medium">1Y</th>
              <th className="px-3 py-2 text-right font-medium">% from 52wH</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r, i) => (
              <tr key={r.symbol} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface-hover)]">
                <td className="px-3 py-2 tabular-nums text-[var(--text-4)]">{i + 1}</td>
                <td className="px-3 py-2">
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{r.symbol}</Link>
                  {r.breakout && <span className="ml-1.5" title="Breakout: near 52wH + golden cross above 200d MA">🚀</span>}
                  <span className="ml-2 hidden text-[var(--text-4)] sm:inline">{r.name.length > 26 ? r.name.slice(0, 26) + "…" : r.name}</span>
                  <span className="ml-2 text-[10px] text-[var(--text-4)]">{r.sector}</span>
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="h-1.5 w-12 overflow-hidden rounded bg-[var(--bg)]">
                      <div className="h-1.5 rounded" style={{ width: `${r.rs}%`, background: r.rs >= 70 ? "#22c55e" : r.rs >= 40 ? "#f59e0b" : "#ef4444" }} />
                    </div>
                    <span className="w-6 text-right font-mono tabular-nums text-[var(--text-2)]">{r.rs}</span>
                  </div>
                </td>
                <td className="px-2 py-2">
                  <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10px] font-medium" style={{ color: QUADRANT_META[r.quadrant].color, background: QUADRANT_META[r.quadrant].color + "1a" }}>
                    {r.quadrant}
                    <span title="RS momentum (recent vs longer-horizon strength)">{r.momentum > 0 ? "↑" : r.momentum < 0 ? "↓" : "→"}</span>
                  </span>
                </td>
                <td className="px-2 py-2 text-right tabular-nums" style={{ color: col(r.ret3m) }}>{pct(r.ret3m)}</td>
                <td className="px-2 py-2 text-right tabular-nums" style={{ color: col(r.ret6m) }}>{pct(r.ret6m)}</td>
                <td className="px-2 py-2 text-right tabular-nums" style={{ color: col(r.ret1y) }}>{pct(r.ret1y)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--text-3)]">{pct(r.pctFromHigh)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-4)]">RS = percentile of a blended 1w/3m/6m/1y return vs every name in {UNIVERSE_BY_ID[universe]?.name ?? "this universe"} (longer horizons weighted more). Trend quadrant from RS level vs. RS momentum. Snapshot data — not investment advice.</p>
    </main>
  );
}
