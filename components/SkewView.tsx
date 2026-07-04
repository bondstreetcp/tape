"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { VolDisData, VolDisRow } from "@/lib/volDislocation";
import { premColor, premVerdict } from "@/lib/volDislocation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

type F = "call" | "put" | "all";

// skew (decimal) = OTM put IV − OTM call IV. >0 = puts richer (downside bid, the equity norm); <0 = calls
// richer (upside bid — unusual, and worth a look: takeover/squeeze/positive-catalyst speculation).
const readOf = (sk: number): { t: string; c: string } =>
  sk < 0 ? { t: "call skew — upside bid", c: "#14b8a6" } : sk >= 0.15 ? { t: "heavy put skew — downside hedged", c: "#f59e0b" } : { t: "put skew (normal)", c: "var(--text-3)" };
const skewColor = (sk: number) => (sk < 0 ? "#14b8a6" : sk >= 0.15 ? "#f59e0b" : "var(--text-2)");

export default function SkewView({ universe, data }: { universe: string; data: VolDisData }) {
  const [f, setF] = useState<F>("call");
  const [q, setQ] = useState("");

  const base = useMemo(() => data.rows.filter((r) => !r.illiquid && r.skew != null), [data.rows]);
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    const rs = base.filter((r) => {
      const sk = r.skew as number;
      if (f === "call" && !(sk < 0)) return false;
      if (f === "put" && !(sk >= 0.15)) return false;
      if (ql && !r.symbol.toLowerCase().includes(ql) && !r.name.toLowerCase().includes(ql)) return false;
      return true;
    });
    // call tab → most call-skewed (most negative) first; put tab → most put-skewed first; all → by |skew|
    return [...rs].sort((a, b) => {
      const sa = a.skew as number, sb = b.skew as number;
      if (f === "call") return sa - sb;
      if (f === "put") return sb - sa;
      return Math.abs(sb) - Math.abs(sa);
    });
  }, [base, f, q]);

  const callN = base.filter((r) => (r.skew as number) < 0).length;
  const putN = base.filter((r) => (r.skew as number) >= 0.15).length;
  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(0)}%`);
  const vp = (sk: number) => `${sk > 0 ? "+" : ""}${(sk * 100).toFixed(0)}`;

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Skew — where the options market leans up or down</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Option <b>skew</b> <InfoDot term="Skew" /> — OTM put IV minus OTM call IV, in vol points. Equity skew is almost always <b>put-heavy</b> (downside is bid). When calls get bid instead (<b style={{ color: "#14b8a6" }}>negative skew</b>) it&apos;s unusual — often takeover / squeeze / positive-catalyst speculation. A ranked <b>risk-reversal</b> <InfoDot term="Risk reversal" /> watchlist. {callN} call-skewed · {putN} heavily put-skewed · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setF("call")} className={TB(f === "call")} title="Calls richer than puts — unusual upside bid">Call-skewed ↑ ({callN})</button>
          <button onClick={() => setF("put")} className={TB(f === "put")} title="Heavy downside protection bid">Put-skewed ↓ ({putN})</button>
          <button onClick={() => setF("all")} className={TB(f === "all")}>All</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or company…" className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} names</span>
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-4)]">
        Skew here = OTM put IV − OTM call IV (an approximate risk-reversal, not a clean 25Δ RR), solved nightly from the chain (vendor IV treated as junk). <b style={{ color: "#14b8a6" }}>Call skew</b> is the rare, high-signal case — pair it with the news/filings before assuming a bid. The <span style={{ color: "#f59e0b" }}>⚡</span> tag is an AI read of recent headlines. Decision support, not advice.
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[820px] text-left text-[13px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-3 py-2 font-medium">Ticker</th>
              <th className="px-2 py-2 font-medium">Sector</th>
              <th className="px-2 py-2 text-right font-medium">ATM IV<InfoDot term="ATM" /></th>
              <th className="px-2 py-2 text-right font-medium" title="OTM put IV − OTM call IV, in vol points; >0 = puts richer (downside bid), <0 = calls richer (upside bid)">Skew<InfoDot term="Skew" /></th>
              <th className="px-2 py-2 font-medium">Read</th>
              <th className="px-2 py-2 text-right font-medium" title="ATM IV ÷ realized vol">IV / RV<InfoDot term="IV / RV" /></th>
              <th className="px-2 py-2 whitespace-nowrap font-medium">Next earnings</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const sk = r.skew as number;
              const rd = readOf(sk);
              return (
                <tr key={r.symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                  <td className="px-3 py-2">
                    <Link href={`/u/${universe}/stock/${r.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                    <div className="max-w-[160px] truncate text-[11px] text-[var(--text-4)]">{r.name}</div>
                    {r.catalyst && (
                      <div className="mt-0.5 max-w-[180px] truncate text-[11px]" style={{ color: r.catalyst.kind === "event" ? "#f59e0b" : "var(--text-4)" }} title={`AI read of recent headlines (${Math.round(r.catalyst.confidence * 100)}% conf)`}>⚡ {r.catalyst.text}</div>
                    )}
                  </td>
                  <td className="px-2 py-2 text-[12px] text-[var(--text-3)]">{r.sector}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{pct(r.atmIV)}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: skewColor(sk) }}>{vp(sk)}</td>
                  <td className="px-2 py-2 text-[12px] font-medium" style={{ color: rd.c }}>{rd.t}</td>
                  <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: premColor(r.ivPremium) }} title={premVerdict(r.ivPremium)}>{r.ivPremium.toFixed(2)}×</td>
                  <td className="px-2 py-2 whitespace-nowrap text-[11px]">
                    {r.earningsDriven && r.daysToEarnings != null ? <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[var(--text-4)]" title="Reports inside the front expiry">earnings {r.daysToEarnings}d</span> : r.daysToEarnings != null && r.daysToEarnings >= 0 ? <span className="text-[var(--text-4)]">{r.daysToEarnings}d</span> : <span className="text-[var(--text-4)]">—</span>}
                  </td>
                </tr>
              );
            })}
            {!rows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-[var(--text-4)]">No names match.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
