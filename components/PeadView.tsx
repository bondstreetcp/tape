"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { PeadData } from "@/lib/pead";
import { moveColor } from "@/lib/pead";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

type F = "cont" | "fade" | "all";
const sg = (x: number) => `${x > 0 ? "+" : ""}${x.toFixed(1)}%`;

export default function PeadView({ universe, data }: { universe: string; data: PeadData }) {
  const [f, setF] = useState<F>("cont");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (f === "cont" && !r.continuation) return false;
      if (f === "fade" && r.continuation) return false;
      if (ql && !r.symbol.toLowerCase().includes(ql) && !r.name.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [data.rows, f, q]);

  const contN = data.rows.filter((r) => r.continuation).length;
  const fadeN = data.rows.length - contN;
  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Post-earnings drift — who&apos;s still moving after the print</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Names that reported recently, and where the stock has drifted <b>since</b> the print <InfoDot term="PEAD" />. The earnings-day <b>gap</b> is the market&apos;s reaction; the <b>drift</b> after is the continuation. When the drift keeps going the gap&apos;s way (<b style={{ color: "#22c55e" }}>continues</b>), that&apos;s the classic PEAD momentum — the surprise keeps getting priced in. {data.scanned} recent reporters · {contN} continuing · {fadeN} fading · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setF("cont")} className={TB(f === "cont")} title="Drift continues the earnings-day gap — momentum">Continuing ({contN})</button>
          <button onClick={() => setF("fade")} className={TB(f === "fade")} title="Drift reverses the gap — the reaction is fading">Fading ({fadeN})</button>
          <button onClick={() => setF("all")} className={TB(f === "all")}>All</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or company…" className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} names</span>
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-4)]">
        Gap = the first-session close-to-close reaction to the report; drift = the cumulative return since, both from the daily price series. Recent reporters come from the earnings 8-K dates (guidance set). A continuing drift is decision support, not a call — PEAD is a tendency, not a guarantee.
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[820px] text-left text-[13px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-3 py-2 font-medium">Ticker</th>
              <th className="px-2 py-2 font-medium">Sector</th>
              <th className="px-2 py-2 text-right font-medium">Reported</th>
              <th className="px-2 py-2 text-right font-medium" title="First-session close-to-close reaction to the report">Gap</th>
              <th className="px-2 py-2 text-right font-medium" title="Cumulative return since the reaction session">Drift since</th>
              <th className="px-2 py-2 font-medium">Read</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                <td className="px-3 py-2">
                  <Link href={`/u/${universe}/stock/${r.symbol}?tab=earnings`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                  <div className="max-w-[160px] truncate text-[11px] text-[var(--text-4)]">{r.name}</div>
                </td>
                <td className="px-2 py-2 text-[12px] text-[var(--text-3)]">{r.sector}</td>
                <td className="px-2 py-2 text-right text-[12px] tabular-nums text-[var(--text-4)]" title={r.reportedAt}>{r.daysSince}d ago</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: moveColor(r.gapPct) }}>{sg(r.gapPct)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: moveColor(r.driftPct) }}>{sg(r.driftPct)}</td>
                <td className="px-2 py-2 text-[12px] font-medium" style={{ color: r.continuation ? "#22c55e" : "var(--text-3)" }}>
                  {r.continuation ? `continues ${r.gapPct > 0 ? "↑" : "↓"}` : "fading"}
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="px-3 py-8 text-center text-[var(--text-4)]">No recent reporters match.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
