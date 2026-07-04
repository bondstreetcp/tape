"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { SeasonData } from "@/lib/seasonality";
import { ampColor, ampRead } from "@/lib/seasonality";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

type F = "big" | "quiet" | "all";
const sg = (x: number | null) => (x == null ? "—" : `${x > 0 ? "+" : ""}${x.toFixed(1)}%`);

export default function SeasonalityView({ universe, data }: { universe: string; data: SeasonData }) {
  const [f, setF] = useState<F>("big");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const rs = data.rows.filter((r) => {
      if (f === "big" && !(r.amplifier >= 2.5)) return false;
      if (f === "quiet" && !(r.amplifier <= 1.5)) return false;
      if (ql && !r.symbol.toLowerCase().includes(ql) && !r.name.toLowerCase().includes(ql)) return false;
      return true;
    });
    return f === "quiet" ? [...rs].sort((a, b) => a.amplifier - b.amplifier) : rs;
  }, [data.rows, f, q]);

  const bigN = data.rows.filter((r) => r.amplifier >= 2.5).length;
  const quietN = data.rows.filter((r) => r.amplifier <= 1.5).length;
  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Earnings seasonality — who moves big on the print</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            The <b>earnings amplifier</b>: how much bigger a name&apos;s average post-earnings move is than a normal day (avg |move| ÷ its typical daily move). <b style={{ color: "#f59e0b" }}>High</b> = the print is a real event (a straddle-buyer&apos;s name historically); <b style={{ color: "#14b8a6" }}>low</b> = quiet earnings (a premium-seller&apos;s name). {data.scanned} names · {bigN} big movers · {quietN} quiet · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setF("big")} className={TB(f === "big")} title="Move ≥ 2.5× a normal day on earnings">Big movers ({bigN})</button>
          <button onClick={() => setF("quiet")} className={TB(f === "quiet")} title="Barely move more than a normal day">Quiet ({quietN})</button>
          <button onClick={() => setF("all")} className={TB(f === "all")}>All</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or company…" className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} names</span>
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-4)]">
        <b>Approximate:</b> this backtests the REALIZED earnings move vs a realized-vol baseline — not a true bought/sold-straddle P&amp;L, because the app doesn&apos;t store the historical implied vol (what the straddle cost) at each past print. So it tells you a name moves big/quiet on earnings, not whether the straddle was rich or cheap then. Reactions from the SEC 8-K dates + the daily series. Decision support, not advice.
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[900px] text-left text-[13px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-3 py-2 font-medium">Ticker</th>
              <th className="px-2 py-2 font-medium">Sector</th>
              <th className="px-2 py-2 text-right font-medium" title="avg |earnings move| ÷ typical daily move">Amplifier</th>
              <th className="px-2 py-2 font-medium">Read</th>
              <th className="px-2 py-2 text-right font-medium">Avg move</th>
              <th className="px-2 py-2 text-right font-medium">Normal day</th>
              <th className="px-2 py-2 text-right font-medium" title="fraction of prints that moved > 2× a normal day">Big-move rate</th>
              <th className="px-2 py-2 text-right font-medium" title="avg 5-session post-earnings drift">Drift 5d<InfoDot term="PEAD" /></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                <td className="px-3 py-2">
                  <Link href={`/u/${universe}/stock/${r.symbol}?tab=earnings`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                  <div className="max-w-[160px] truncate text-[11px] text-[var(--text-4)]">{r.name} <span className="text-[10px]">· {r.n}q</span></div>
                </td>
                <td className="px-2 py-2 text-[12px] text-[var(--text-3)]">{r.sector}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: ampColor(r.amplifier) }}>{r.amplifier.toFixed(1)}×</td>
                <td className="px-2 py-2 text-[12px] font-medium" style={{ color: ampColor(r.amplifier) }}>{ampRead(r.amplifier)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">±{r.avgAbsMovePct.toFixed(1)}%</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-4)]">±{r.dailyMovePct.toFixed(1)}%</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{(r.bigRate * 100).toFixed(0)}%</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: r.avgDrift5 != null ? (r.avgDrift5 > 0 ? "#22c55e" : "#ef4444") : "var(--text-4)" }}>{sg(r.avgDrift5)}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={8} className="px-3 py-8 text-center text-[var(--text-4)]">{data.scanned ? "No names match." : "Builds on the nightly reactions fetch — check back after the next refresh."}</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
