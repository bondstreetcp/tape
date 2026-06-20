"use client";
import { useMemo } from "react";
import type { SeriesPoint } from "@/lib/types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Average month-over-month return by calendar month, from the stock's daily history. */
export default function SeasonalityPanel({ daily }: { daily: SeriesPoint[] }) {
  const stats = useMemo(() => {
    if (daily.length < 260) return null;
    const monthEnd = new Map<string, number>(); // "YYYY-MM" -> last close (daily is sorted ascending)
    for (const p of daily) {
      const d = new Date(p.t);
      monthEnd.set(`${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`, p.c);
    }
    const keys = [...monthEnd.keys()].sort();
    const rets: { month: number; ret: number }[] = [];
    for (let i = 1; i < keys.length; i++) {
      const prev = monthEnd.get(keys[i - 1])!, cur = monthEnd.get(keys[i])!;
      if (prev) rets.push({ month: Number(keys[i].slice(5, 7)) - 1, ret: cur / prev - 1 });
    }
    if (rets.length < 12) return null;
    return MONTHS.map((_, m) => {
      const rs = rets.filter((r) => r.month === m).map((r) => r.ret);
      if (!rs.length) return { avg: null as number | null, pos: null as number | null, n: 0 };
      return { avg: rs.reduce((a, b) => a + b, 0) / rs.length, pos: rs.filter((r) => r > 0).length / rs.length, n: rs.length };
    });
  }, [daily]);

  if (!stats) return null;
  const max = Math.max(...stats.map((s) => Math.abs(s.avg ?? 0)), 0.01);
  const color = (v: number | null) =>
    v == null ? "var(--surface-2)" : `rgba(${v >= 0 ? "34,197,94" : "239,68,68"},${Math.min(0.9, (Math.abs(v) / max) * 0.75 + 0.15)})`;
  const withData = stats.map((s, m) => ({ ...s, m })).filter((s) => s.avg != null) as { avg: number; pos: number; n: number; m: number }[];
  const best = withData.reduce((a, b) => (b.avg > a.avg ? b : a), withData[0]);
  const worst = withData.reduce((a, b) => (b.avg < a.avg ? b : a), withData[0]);

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">Seasonality — avg monthly return</h3>
        {best && worst && (
          <span className="text-[11px] text-[var(--text-4)]">
            Strongest <span className="font-semibold text-[#22c55e]">{MONTHS[best.m]} {(best.avg * 100).toFixed(1)}%</span> · weakest <span className="font-semibold text-[#ef4444]">{MONTHS[worst.m]} {(worst.avg * 100).toFixed(1)}%</span>
          </span>
        )}
      </div>
      <div className="grid grid-cols-6 gap-1.5 sm:grid-cols-12">
        {stats.map((s, m) => (
          <div
            key={m}
            className="rounded p-1.5 text-center text-white [text-shadow:0_1px_2px_rgba(0,0,0,0.4)]"
            style={{ background: color(s.avg) }}
            title={s.n ? `${MONTHS[m]}: avg ${((s.avg ?? 0) * 100).toFixed(1)}%, ${((s.pos ?? 0) * 100).toFixed(0)}% positive (${s.n} yrs)` : MONTHS[m]}
          >
            <div className="text-[10px] opacity-90">{MONTHS[m]}</div>
            <div className="font-mono text-xs font-semibold tabular-nums">{s.avg == null ? "—" : `${s.avg >= 0 ? "+" : ""}${(s.avg * 100).toFixed(1)}`}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-[10px] text-[var(--text-4)]">Average month-over-month return per calendar month over the available history (~5 yrs); hover for the share of positive months. Past seasonality isn&apos;t predictive.</p>
    </section>
  );
}
