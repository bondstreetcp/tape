"use client";
import { useState } from "react";
import { currencyPrefix } from "@/lib/format";

interface Seg { name: string; revenue: number; operatingIncome: number | null; marginPct: number | null; revGrowthPct: number | null }
interface Data { configured: boolean; available?: boolean; period?: string; url?: string; segments?: Seg[]; read?: string }

export default function SegmentEconomics({ symbol, currency }: { symbol: string; currency?: string }) {
  const [data, setData] = useState<Data | "idle" | "loading">("idle");
  const run = () => {
    setData("loading");
    fetch(`/api/segment-economics/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d: Data) => setData(d))
      .catch(() => setData({ configured: true, available: false }));
  };
  const d = typeof data === "object" ? data : null;
  const sym = currencyPrefix(currency);
  const fmt = (v: number | null) => (v == null ? "—" : Math.abs(v) >= 1000 ? `${sym}${(v / 1000).toFixed(1)}B` : `${sym}${Math.round(v)}M`);
  const pc = (v: number | null, d2 = 0) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d2)}%`);
  const total = d?.segments?.reduce((s, x) => s + (x.revenue || 0), 0) || 0;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-[var(--text-2)]">Segment economics</h3>
          <span className="text-[11px] text-[var(--text-4)]">revenue, operating income &amp; margin by segment</span>
        </div>
        {data === "idle" && <button onClick={run} className="shrink-0 rounded-lg bg-[var(--accent-strong)] px-2.5 py-1 text-xs font-medium text-white transition-colors hover:opacity-90">Break out the segment P&amp;L →</button>}
      </div>

      {data === "loading" && <div className="flex items-center gap-2 py-2 text-xs text-[var(--text-3)]"><span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)]" /> Reading the segment footnote…</div>}
      {d && d.configured === false && <div className="py-2 text-xs text-[var(--text-3)]">AI isn&apos;t configured.</div>}
      {d && d.configured && d.available === false && <div className="py-2 text-xs text-[var(--text-3)]">Per-segment operating income isn&apos;t broken out in the latest filing.</div>}

      {d && d.available && d.segments && d.segments.length > 0 && (
        <div>
          <div className="mb-2 text-[11px] text-[var(--text-4)]">{d.period}{d.url && <> · <a href={d.url} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">10-K ↗</a></>}</div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b border-[var(--border)] text-left text-[var(--text-3)]">
                  <th className="py-1 pr-2 font-medium">Segment</th>
                  <th className="px-2 py-1 text-right font-medium">Revenue</th>
                  <th className="px-2 py-1 text-right font-medium">% mix</th>
                  <th className="px-2 py-1 text-right font-medium">Op. income</th>
                  <th className="px-2 py-1 text-right font-medium">Margin</th>
                  <th className="pl-2 py-1 text-right font-medium">Rev YoY</th>
                </tr>
              </thead>
              <tbody>
                {d.segments.map((s, i) => (
                  <tr key={i} className="border-b border-[var(--divider)] last:border-0">
                    <td className="py-1.5 pr-2 text-[var(--text-2)]">{s.name}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[var(--text)]">{fmt(s.revenue)}</td>
                    <td className="px-2 py-1.5 text-right tabular-nums text-[var(--text-3)]">{total ? `${((s.revenue / total) * 100).toFixed(0)}%` : "—"}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums" style={{ color: s.operatingIncome != null && s.operatingIncome < 0 ? "#ef4444" : "var(--text)" }}>{fmt(s.operatingIncome)}</td>
                    <td className="px-2 py-1.5 text-right font-mono tabular-nums" style={{ color: s.marginPct == null ? "var(--text-3)" : s.marginPct >= 20 ? "#22c55e" : s.marginPct < 0 ? "#ef4444" : "var(--text-2)" }}>{s.marginPct == null ? "—" : `${s.marginPct.toFixed(0)}%`}</td>
                    <td className="pl-2 py-1.5 text-right font-mono tabular-nums" style={{ color: s.revGrowthPct == null ? "var(--text-3)" : s.revGrowthPct >= 0 ? "#22c55e" : "#ef4444" }}>{pc(s.revGrowthPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {d.read && <p className="mt-2.5 text-[12px] leading-snug text-[var(--text-2)]">{d.read}</p>}
          <p className="mt-1.5 text-[10px] text-[var(--text-4)]">Extracted from the segment footnote by AI — verify against the filing. Not investment advice.</p>
        </div>
      )}
    </section>
  );
}
