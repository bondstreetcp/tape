"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { DistributionName } from "@/lib/smartMoneySell";
import { toneColor, toneLabel } from "@/lib/smartMoneySell";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import HowToRead from "./HowToRead";

const money = (v: number | null) => (v == null ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(1)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${Math.round((v ?? 0) / 1e3)}K`);
const pctStr = (v: number | null) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`);
type ToneF = "all" | "capitulation" | "profit-taking";

export default function DistributionView({ names, universe, asOf }: { names: DistributionName[]; universe: string; asOf: string | null }) {
  const [toneF, setToneF] = useState<ToneF>("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return names.filter((n) => {
      if (toneF !== "all" && n.tone !== toneF) return false;
      if (ql && !n.symbol.toLowerCase().includes(ql) && !n.name.toLowerCase().includes(ql) && !n.sellers.some((s) => s.manager.toLowerCase().includes(ql))) return false;
      return true;
    });
  }, [names, toneF, q]);

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}/smart-money`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← Smart-Money Radar</Link>
          <h1 className="mt-1 text-2xl font-bold">Smart-Money Distribution</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            The sell side of the super-investor 13Fs — names that <b>2+ managers</b> fully exited or sharply trimmed last quarter. The mirror of the Radar&apos;s accumulation. {names.length} names · 13F as of {asOf ?? "—"}
          </p>
        </div>
      </div>

      <HowToRead>
        <p><b>What this is:</b> where the tracked super-investors are <i>leaving</i>, not entering — aggregated across the 56-manager roster from their latest quarterly 13F. A name needs 2+ managers exiting/trimming to appear, so it&apos;s consensus distribution, not one fund rebalancing.</p>
        <p><b>Exited</b> = a manager fully sold out; <b>trimmed</b> = a sharp reduction (with the cut %). Full exits weigh double a trim in the score.</p>
        <p><b>Into weakness / into strength:</b> the price context matters. Gurus dumping a name that&apos;s <b style={{ color: "#ef4444" }}>down YTD</b> reads as <i>capitulation</i> (the thesis may have broken); selling one that&apos;s <b style={{ color: "#f59e0b" }}>up YTD</b> reads as <i>profit-taking</i> (less alarming).</p>
        <p><b>Big caveat:</b> a 13F sale is far noisier than a buy — redemptions, risk limits, and rebalancing all force selling unrelated to a view. Treat this as a "consensus is leaving" flag to investigate, not a short list. 13Fs also lag ~45 days. Not advice.</p>
      </HowToRead>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setToneF("all")} className={TB(toneF === "all")}>All</button>
          <button onClick={() => setToneF("capitulation")} className={TB(toneF === "capitulation")} title="Gurus exiting a name that's down YTD">Into weakness</button>
          <button onClick={() => setToneF("profit-taking")} className={TB(toneF === "profit-taking")} title="Gurus exiting a name that's up YTD">Into strength</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker, name, manager…" className="w-52 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} of {names.length}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[880px] text-left text-[13px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-3 py-2 font-medium">Ticker</th>
              <th className="px-2 py-2 text-right font-medium" title="Full exits weigh double a trim">Sellers</th>
              <th className="px-2 py-2 font-medium">Who&apos;s leaving</th>
              <th className="px-2 py-2 text-right font-medium">YTD</th>
              <th className="px-2 py-2 text-center font-medium">Read</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((n) => (
              <tr key={n.symbol} className="border-b border-[var(--border)] last:border-0 align-top hover:bg-[var(--surface-2)]">
                <td className="px-3 py-2">
                  <Link href={`/u/${universe}/stock/${n.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{n.symbol}</Link>
                  <div className="max-w-[160px] truncate text-[11px] text-[var(--text-4)]">{n.name}{n.sector ? ` · ${n.sector}` : ""}</div>
                </td>
                <td className="px-2 py-2 text-right whitespace-nowrap">
                  {n.exitedN > 0 && <span className="font-mono font-semibold text-[#ef4444]">{n.exitedN} exited</span>}
                  {n.exitedN > 0 && n.trimmedN > 0 && <span className="text-[var(--text-4)]"> · </span>}
                  {n.trimmedN > 0 && <span className="font-mono text-[var(--text-3)]">{n.trimmedN} trim</span>}
                </td>
                <td className="px-2 py-2">
                  <div className="flex flex-wrap gap-1">
                    {n.sellers.slice(0, 5).map((s, i) => (
                      <span key={i} className="rounded px-1.5 py-0.5 text-[11px]" style={{ background: s.action === "exited" ? "color-mix(in oklab, #ef4444 14%, transparent)" : "var(--surface-2)", color: s.action === "exited" ? "#ef4444" : "var(--text-2)" }} title={s.action === "exited" ? "fully sold out" : `trimmed${s.deltaPct != null ? ` ${Math.round(s.deltaPct * 100)}%` : ""}`}>
                        {s.manager}{s.action === "trimmed" && s.deltaPct != null ? ` ${Math.round(s.deltaPct * 100)}%` : ""}
                      </span>
                    ))}
                    {n.sellers.length > 5 && <span className="text-[11px] text-[var(--text-4)]">+{n.sellers.length - 5}</span>}
                  </div>
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: n.retYtd == null ? "var(--text-4)" : n.retYtd >= 0 ? "#22c55e" : "#ef4444" }}>{pctStr(n.retYtd)}</td>
                <td className="px-2 py-2 text-center whitespace-nowrap">
                  <span className="rounded px-1.5 py-0.5 text-[11px] font-medium" style={{ color: toneColor(n.tone), background: `color-mix(in oklab, ${toneColor(n.tone)} 14%, transparent)` }}>{toneLabel(n.tone)}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
