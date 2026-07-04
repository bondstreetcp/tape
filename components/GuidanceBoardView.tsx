"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { GuidanceBoardData } from "@/lib/guidanceBoard";
import { tagColor, tagLabel, actionColor } from "@/lib/guidanceBoard";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

type F = "all" | "track" | "sandbagger" | "raising";

const eps = (lo: number | null, hi: number | null) =>
  lo != null && hi != null ? (lo === hi ? `$${lo}` : `$${lo}–$${hi}`) : lo != null ? `$${lo}` : hi != null ? `$${hi}` : "—";
// ≥$10B → 1 decimal of billions; <$10B → 2 decimals, so a narrow range (e.g. $2.00–2.02B) stays distinct.
const revM = (m: number | null) => (m == null ? null : m >= 1000 ? `$${(m / 1000).toFixed(m >= 10000 ? 1 : 2)}B` : `$${m.toFixed(0)}M`);
const rev = (lo: number | null, hi: number | null) => {
  const a = revM(lo), b = revM(hi);
  return a && b ? (lo === hi ? a : `${a}–${b}`) : a || b || null; // collapse on the RAW bounds, not the rounded strings
};
const pctVs = (x: number | null) => (x == null ? "—" : `${x >= 0 ? "+" : ""}${(x * 100).toFixed(1)}%`);

export default function GuidanceBoardView({ universe, data }: { universe: string; data: GuidanceBoardData }) {
  const [f, setF] = useState<F>("all");
  const [q, setQ] = useState("");

  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return data.rows.filter((r) => {
      if (f === "track" && r.total == null) return false;
      if (f === "sandbagger" && r.tag !== "sandbagger") return false;
      if (f === "raising" && r.action !== "raise") return false;
      if (ql && !r.symbol.toLowerCase().includes(ql) && !r.name.toLowerCase().includes(ql)) return false;
      return true;
    });
  }, [data.rows, f, q]);

  const trackN = data.rows.filter((r) => r.total != null).length;
  const sandN = data.rows.filter((r) => r.tag === "sandbagger").length;
  const overN = data.rows.filter((r) => r.tag === "over-promiser").length;
  const raiseN = data.rows.filter((r) => r.action === "raise").length;
  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Guidance — the standing outlook &amp; who beats their own guide</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Each company&apos;s current guidance <InfoDot term="Guidance" /> (the forward revenue/EPS it&apos;s promised) and whether it <b>raised</b>, <b>reaffirmed</b> or <b>cut</b> <InfoDot term="Raise / reaffirm / cut" /> it — plus, where the history supports it, its <b>beats-its-own-guide</b> track record <InfoDot term="Beats its own guide" />. <b style={{ color: tagColor("sandbagger") }}>Sandbaggers</b> <InfoDot term="Sandbagger" /> guide low then beat (the guide is a floor); <b style={{ color: tagColor("over-promiser") }}>over-promisers</b> reliably miss. {data.scanned} names · {trackN} with a track record ({sandN} sandbaggers, {overN} over-promisers) · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setF("all")} className={TB(f === "all")}>All</button>
          <button onClick={() => setF("track")} className={TB(f === "track")} title="Only names with a beats-its-own-guide track record">Track record ({trackN})</button>
          <button onClick={() => setF("sandbagger")} className={TB(f === "sandbagger")} title="Guide low, reliably beat">Sandbaggers ({sandN})</button>
          <button onClick={() => setF("raising")} className={TB(f === "raising")} title="Most recent guide RAISED the outlook">Raised ({raiseN})</button>
        </div>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or company…" className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} names</span>
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-4)]">
        Guidance is a company-disclosed forward statement with no API/XBRL tag — it&apos;s LLM-extracted from each earnings 8-K and re-checked nightly. The track record aligns each quarter&apos;s actual EPS to the guide given one quarter earlier; it needs ≥2 comparable quarters, so it fills in over time. Decision support, not advice.
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[920px] text-left text-[13px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-3 py-2 font-medium">Ticker</th>
              <th className="px-2 py-2 font-medium">Sector</th>
              <th className="px-2 py-2 font-medium">Guide period</th>
              <th className="px-2 py-2 text-right font-medium">EPS guide</th>
              <th className="px-2 py-2 text-right font-medium">Revenue guide</th>
              <th className="px-2 py-2 text-center font-medium">Action<InfoDot term="Raise / reaffirm / cut" /></th>
              <th className="px-2 py-2 font-medium">Track record<InfoDot term="Beats its own guide" /></th>
              <th className="px-2 py-2 text-right font-medium">Next</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                <td className="px-3 py-2">
                  <Link href={`/u/${universe}/stock/${r.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                  <div className="max-w-[150px] truncate text-[11px] text-[var(--text-4)]">{r.name}</div>
                </td>
                <td className="px-2 py-2 text-[12px] text-[var(--text-3)]">{r.sector}</td>
                <td className="px-2 py-2 text-[12px] text-[var(--text-2)]">{r.period}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{eps(r.epsLow, r.epsHigh)}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-3)]">{rev(r.revLowM, r.revHighM) ?? "—"}</td>
                <td className="px-2 py-2 text-center">
                  {r.action && r.action !== "none" ? (
                    <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: actionColor(r.action), background: `color-mix(in oklab, ${actionColor(r.action)} 14%, transparent)` }}>{r.action}</span>
                  ) : (
                    <span className="text-[11px] text-[var(--text-4)]">—</span>
                  )}
                </td>
                <td className="px-2 py-2 text-[12px]">
                  {r.total != null ? (
                    <span className="flex items-center gap-1.5">
                      <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: tagColor(r.tag), background: `color-mix(in oklab, ${tagColor(r.tag)} 14%, transparent)` }}>{tagLabel(r.tag)}</span>
                      <span className="font-mono tabular-nums text-[var(--text-3)]" title="Times its actual EPS met/beat the guide it gave a quarter earlier">{r.beats}/{r.total}</span>
                      {r.avgVsGuide != null && <span className="font-mono tabular-nums text-[11px]" style={{ color: r.avgVsGuide >= 0 ? "#22c55e" : "#ef4444" }} title="Average actual EPS vs the guide midpoint">{pctVs(r.avgVsGuide)}</span>}
                    </span>
                  ) : (
                    <span className="text-[11px] text-[var(--text-4)]">accruing…</span>
                  )}
                </td>
                <td className="px-2 py-2 text-right text-[12px] tabular-nums text-[var(--text-3)]" title={r.nextEarnings ? new Date(r.nextEarnings).toLocaleDateString() : undefined}>
                  {r.daysToEarnings != null && r.daysToEarnings >= 0 ? `${r.daysToEarnings}d` : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </main>
  );
}
