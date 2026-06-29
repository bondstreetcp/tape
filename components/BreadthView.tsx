"use client";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import type { BreadthData, RegimeItem } from "@/lib/breadth";

const TONE: Record<"up" | "neutral" | "down", string> = { up: "#22c55e", neutral: "#f59e0b", down: "#ef4444" };
const barColor = (pct: number) => (pct >= 60 ? "#22c55e" : pct >= 40 ? "#f59e0b" : "#ef4444");

function Gauge({ label, pct, sub }: { label: string; pct: number; sub: string }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-[11px] text-[var(--text-3)]">{label}</div>
      <div className="mt-0.5 text-2xl font-bold tabular-nums" style={{ color: barColor(pct) }}>{pct}%</div>
      <div className="mt-1.5 h-1.5 w-full overflow-hidden rounded bg-[var(--bg)]">
        <div className="h-1.5 rounded" style={{ width: `${pct}%`, background: barColor(pct) }} />
      </div>
      <div className="mt-1 text-[10px] text-[var(--text-4)]">{sub}</div>
    </div>
  );
}

export default function BreadthView({ data, regime, universe }: { data: BreadthData; regime: RegimeItem[]; universe: string }) {
  const uname = UNIVERSE_BY_ID[universe]?.name ?? universe;
  const advTotal = data.advancers + data.decliners + data.unchanged || 1;
  const advPct = Math.round((data.advancers / advTotal) * 100);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {uname}</Link>
      <div className="mt-1" />
      <PageHeader
        title="Breadth & Regime"
        desc="Market internals: how many names actually participate in the move (above their moving averages, at new highs, positive on the year) and the macro risk backdrop. Tells you whether a rally is broad or a few names carrying the tape. Decision-support, not advice."
      />

      {/* Verdict */}
      <div className="mb-4 rounded-xl border p-3 text-sm" style={{ borderColor: TONE[data.verdict.tone] + "55", background: TONE[data.verdict.tone] + "12" }}>
        <span className="font-semibold" style={{ color: TONE[data.verdict.tone] }}>{data.verdict.tone === "up" ? "Broad participation" : data.verdict.tone === "neutral" ? "Mixed participation" : "Narrow participation"}</span>
        <span className="text-[var(--text-2)]"> — {data.verdict.text}</span>
      </div>

      {/* Macro regime strip */}
      {regime.length > 0 && (
        <div className="mb-4">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Macro regime (US risk backdrop)</div>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {regime.map((r) => (
              <div key={r.label} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
                <div className="text-[11px] text-[var(--text-3)]">{r.label}</div>
                <div className="mt-0.5 flex items-baseline gap-1.5">
                  <span className="text-lg font-bold tabular-nums" style={{ color: TONE[r.tone] }}>{r.value == null ? "—" : r.value.toFixed(r.unit === "pp" || r.label === "VIX" ? 2 : 2)}{r.unit === "%" ? "%" : ""}</span>
                  <span className="text-[11px]" style={{ color: TONE[r.tone] }}>{r.note}</span>
                </div>
                {r.pctile != null && <div className="mt-0.5 text-[10px] text-[var(--text-4)]">{r.pctile}th %ile vs history</div>}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Headline participation gauges */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Gauge label="Above 200-day MA" pct={data.above200.pct} sub={`${data.above200.count} of ${data.above200.total}`} />
        <Gauge label="Above 50-day MA" pct={data.above50.pct} sub={`${data.above50.count} of ${data.above50.total}`} />
        <Gauge label="Golden cross (50>200)" pct={data.golden.pct} sub={`${data.golden.count} of ${data.golden.total}`} />
        <Gauge label="Within 3% of 52wH" pct={data.nearHigh.pct} sub={`${data.nearHigh.count} of ${data.total} · ${data.nearLow.pct}% near 52wL`} />
      </div>

      {/* Advance/decline + new highs/lows + trend breadth */}
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="text-[11px] text-[var(--text-3)]">Advancers vs decliners (today)</div>
          <div className="mt-1 flex items-baseline justify-between text-sm font-semibold">
            <span className="text-[#22c55e]">{data.advancers} ▲</span>
            <span className="text-[var(--text-4)]">{data.unchanged} flat</span>
            <span className="text-[#ef4444]">▼ {data.decliners}</span>
          </div>
          <div className="mt-1.5 flex h-1.5 w-full overflow-hidden rounded bg-[var(--bg)]">
            <div className="h-1.5 bg-[#22c55e]" style={{ width: `${advPct}%` }} />
            <div className="h-1.5 bg-[#ef4444]" style={{ width: `${100 - advPct}%` }} />
          </div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="text-[11px] text-[var(--text-3)]">New highs vs new lows</div>
          <div className="mt-1 flex items-baseline justify-between">
            <span className="text-lg font-bold text-[#22c55e]">{data.newHighs}</span>
            <span className="text-xs text-[var(--text-4)]">net {data.newHighs - data.newLows >= 0 ? "+" : ""}{data.newHighs - data.newLows}</span>
            <span className="text-lg font-bold text-[#ef4444]">{data.newLows}</span>
          </div>
          <div className="mt-0.5 text-[10px] text-[var(--text-4)]">names at a 52-week high / low</div>
        </div>
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="text-[11px] text-[var(--text-3)]">% of names positive over…</div>
          <div className="mt-1.5 space-y-1">
            {data.trend.map((t) => (
              <div key={t.tf} className="flex items-center gap-2">
                <span className="w-6 text-[10px] text-[var(--text-4)]">{t.tf}</span>
                <div className="h-1.5 flex-1 overflow-hidden rounded bg-[var(--bg)]">
                  <div className="h-1.5 rounded" style={{ width: `${t.pctUp}%`, background: barColor(t.pctUp) }} />
                </div>
                <span className="w-8 text-right text-[10px] tabular-nums text-[var(--text-3)]">{t.pctUp}%</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Sector breadth */}
      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[460px] text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[var(--text-3)]">
              <th className="px-3 py-2 font-medium">Sector</th>
              <th className="px-3 py-2 font-medium">% above 200-day MA</th>
              <th className="px-2 py-2 text-right font-medium">% above 50d</th>
              <th className="px-3 py-2 text-right font-medium">Avg 1D</th>
            </tr>
          </thead>
          <tbody>
            {data.sectors.map((s) => (
              <tr key={s.sector} className="border-b border-[var(--divider)] last:border-0">
                <td className="px-3 py-2 text-[var(--text-2)]">{s.sector} <span className="text-[var(--text-4)]">({s.total})</span></td>
                <td className="px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="h-2 w-28 overflow-hidden rounded bg-[var(--bg)]">
                      <div className="h-2 rounded" style={{ width: `${s.pctAbove200}%`, background: barColor(s.pctAbove200) }} />
                    </div>
                    <span className="w-8 text-right tabular-nums text-[var(--text-2)]">{s.pctAbove200}%</span>
                  </div>
                </td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--text-3)]">{s.pctAbove50}%</td>
                <td className="px-3 py-2 text-right tabular-nums" style={{ color: s.avg1d == null ? "var(--text-3)" : s.avg1d >= 0 ? "#22c55e" : "#ef4444" }}>{s.avg1d == null ? "—" : `${s.avg1d >= 0 ? "+" : ""}${s.avg1d.toFixed(2)}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-4)]">Breadth computed over {data.total} names in {uname}. Macro regime from FRED (data/macro.json), each level percentiled vs its own history. Snapshot data — not investment advice.</p>
    </main>
  );
}
