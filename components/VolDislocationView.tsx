"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { VolDisData } from "@/lib/volDislocation";
import { premColor, premVerdict } from "@/lib/volDislocation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

type F = "rich" | "cheap" | "all";

export default function VolDislocationView({ universe, data }: { universe: string; data: VolDisData }) {
  const [f, setF] = useState<F>("rich");
  const [hideEarn, setHideEarn] = useState(false);
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const rs = data.rows.filter((r) => {
      if (f === "rich" && r.ivPremium < 1.4) return false;
      if (f === "cheap" && r.ivPremium > 1.1) return false;
      if (hideEarn && r.earningsDriven) return false;
      if (ql && !r.symbol.toLowerCase().includes(ql) && !r.name.toLowerCase().includes(ql)) return false;
      return true;
    });
    return f === "cheap" ? [...rs].sort((a, b) => a.ivPremium - b.ivPremium) : rs; // cheapest-first when on the cheap tab
  }, [data.rows, f, hideEarn, q]);

  const richN = data.rows.filter((r) => r.ivPremium >= 1.4).length;
  const cheapN = data.rows.filter((r) => r.ivPremium <= 1.1).length;
  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(0)}%`);

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Vol Dislocation — where option vol is rich or cheap</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Cross-sectional read on the variance premium <InfoDot term="Variance premium" /> — <b>ATM implied vol ÷ realized vol</b> <InfoDot term="Implied volatility" /> — across {data.scanned} quality names. <b style={{ color: premColor(1.6) }}>High</b> = the market's paying up for vol (a premium-seller&apos;s list); <b style={{ color: premColor(0.9) }}>low</b> = vol looks underpriced. Term crush + skew add context; near-earnings names are flagged (their rich vol is <i>expected</i>). {richN} rich · {cheapN} cheap · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setF("rich")} className={TB(f === "rich")} title="ATM IV ≥ 1.4× realized vol">Rich vol</button>
          <button onClick={() => setF("cheap")} className={TB(f === "cheap")} title="ATM IV ≤ 1.1× realized vol">Cheap vol</button>
          <button onClick={() => setF("all")} className={TB(f === "all")}>All</button>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-[var(--text-3)]" title="Hide names reporting inside the front expiry — their rich vol is expected event premium, not a dislocation">
          <input type="checkbox" checked={hideEarn} onChange={(e) => setHideEarn(e.target.checked)} /> hide earnings
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or company…" className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} names</span>
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-4)]">
        A code-detected read, not a call: rich vol may simply be pricing a real catalyst — earnings are flagged, and the <span style={{ color: "#f59e0b" }}>⚡</span> tag is an AI read of the name&apos;s recent headlines (a code-detected signal, contextualized — pair with the filings before trading). IV + realized vol are solved nightly from the options chain (vendor IV treated as junk). Quality large/mid-cap universe. Decision support, not advice.
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[820px] text-left text-[13px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-3 py-2 font-medium">Ticker</th>
              <th className="px-2 py-2 font-medium">Sector</th>
              <th className="px-2 py-2 text-right font-medium">ATM IV</th>
              <th className="px-2 py-2 text-right font-medium">Realized</th>
              <th className="px-2 py-2 text-right font-medium" title="ATM IV ÷ realized vol — the variance premium">IV / RV</th>
              <th className="px-2 py-2 text-right font-medium" title="front-tenor IV ÷ back-tenor IV — >1 = backwardated (event-loaded)">Term</th>
              <th className="px-2 py-2 text-right font-medium" title="front put IV − call IV, vol points — >0 = downside richer">Skew</th>
              <th className="px-2 py-2 text-right font-medium" title="IV percentile vs its own recent history (accrues over time)">IV-rk</th>
              <th className="px-2 py-2 font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                <td className="px-3 py-2">
                  <Link href={`/u/${universe}/stock/${r.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                  <div className="max-w-[160px] truncate text-[11px] text-[var(--text-4)]">{r.name}</div>
                  {r.catalyst && (
                    <div className="mt-0.5 max-w-[180px] truncate text-[11px]" style={{ color: r.catalyst.kind === "event" ? "#f59e0b" : "var(--text-4)" }} title={`AI read of recent headlines (${Math.round(r.catalyst.confidence * 100)}% conf) — the rich vol may be pricing this, not a free dislocation`}>
                      ⚡ {r.catalyst.text}
                    </div>
                  )}
                </td>
                <td className="px-2 py-2 text-[12px] text-[var(--text-3)]">{r.sector}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{pct(r.atmIV)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-4)]">{pct(r.rvol)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: premColor(r.ivPremium) }} title={premVerdict(r.ivPremium)}>{r.ivPremium.toFixed(2)}×</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: r.termCrush != null && r.termCrush >= 1.1 ? "#f59e0b" : "var(--text-3)" }}>{r.termCrush != null ? r.termCrush.toFixed(2) : "—"}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{r.skew != null ? `${r.skew > 0 ? "+" : ""}${(r.skew * 100).toFixed(0)}` : "—"}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-4)]">{r.ivRank != null ? r.ivRank.toFixed(0) : "—"}</td>
                <td className="px-2 py-2 whitespace-nowrap text-[11px]">
                  {r.earningsDriven && <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--text-4)]" title={`Reports in ~${r.daysToEarnings}d — inside the front expiry, so the rich vol is expected event premium`}>earnings {r.daysToEarnings}d</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
