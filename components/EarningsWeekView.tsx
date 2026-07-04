"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

export interface EmRow {
  symbol: string;
  name: string;
  sector: string;
  price: number;
  earningsDate: string;
  daysToEarnings: number;
  earningsEstimate?: boolean;
  straddle?: number;
  impliedMovePct: number;
  histAvgMovePct?: number | null;
  histN?: number;
  richness?: number | null;
}
export interface EmData {
  generatedAt: string;
  source?: string;
  windowDays?: number;
  rows: EmRow[];
}

type F = "all" | "rich" | "cheap";

const richTag = (r: number | null | undefined): { t: string; c: string } | null =>
  r == null ? null : r >= 1.15 ? { t: "rich · sell", c: "#f59e0b" } : r <= 0.85 ? { t: "cheap · buy", c: "#14b8a6" } : { t: "fair", c: "var(--text-4)" };

// BMO / AMC best-effort from the report hour (UTC): before ~15:00 UTC = before the US open, ≥20:00 = after close.
const timing = (iso: string): string => {
  const h = new Date(iso).getUTCHours();
  return h > 0 && h <= 14 ? "BMO" : h >= 20 ? "AMC" : "";
};

export default function EarningsWeekView({ universe, data }: { universe: string; data: EmData }) {
  const [f, setF] = useState<F>("all");

  const upcoming = useMemo(() => data.rows.filter((r) => r.daysToEarnings != null && r.daysToEarnings >= 0 && r.impliedMovePct != null), [data.rows]);
  // rich/cheap is a signal only with enough history — needs ≥3 prior prints, else the "typical move" is noise.
  const reliable = (r: EmRow) => r.histN != null && r.histN >= 3 && r.richness != null;
  const filtered = useMemo(
    () =>
      upcoming.filter((r) => {
        if (f === "rich" && !(reliable(r) && (r.richness as number) >= 1.15)) return false;
        if (f === "cheap" && !(reliable(r) && (r.richness as number) <= 0.85)) return false;
        return true;
      }),
    [upcoming, f],
  );
  // group by calendar day
  const days = useMemo(() => {
    const m = new Map<string, EmRow[]>();
    for (const r of filtered) {
      const key = (r.earningsDate || "").slice(0, 10);
      if (!key) continue;
      (m.get(key) ?? m.set(key, []).get(key)!).push(r);
    }
    return [...m.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, rows]) => ({ date, rows: rows.sort((a, b) => (b.impliedMovePct ?? 0) - (a.impliedMovePct ?? 0)) }));
  }, [filtered]);

  const richN = upcoming.filter((r) => reliable(r) && (r.richness as number) >= 1.15).length;
  const cheapN = upcoming.filter((r) => reliable(r) && (r.richness as number) <= 0.85).length;
  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const dayLabel = (d: string) => new Date(d + "T12:00:00Z").toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Earnings this week — the expected moves</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            Every name reporting in the next {data.windowDays ?? 16} days, by day — the options-implied <b>expected move</b> <InfoDot term="Expected move" /> and whether that straddle looks <b style={{ color: "#f59e0b" }}>rich</b> or <b style={{ color: "#14b8a6" }}>cheap</b> <InfoDot term="Rich / cheap" /> vs the name&apos;s own typical post-earnings reaction. {upcoming.length} reporters · {richN} rich · {cheapN} cheap · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setF("all")} className={TB(f === "all")}>All ({upcoming.length})</button>
          <button onClick={() => setF("rich")} className={TB(f === "rich")} title="Implied move ≥ 1.15× the typical move — sell-premium candidates">Rich ({richN})</button>
          <button onClick={() => setF("cheap")} className={TB(f === "cheap")} title="Implied move ≤ 0.85× the typical move — buy-straddle candidates">Cheap ({cheapN})</button>
        </div>
        <span className="ml-auto text-xs text-[var(--text-4)]">{filtered.length} names · {days.length} days</span>
      </div>

      {!days.length ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--text-3)]">No reporters in the window.</div>
      ) : (
        <div className="space-y-4">
          {days.map(({ date, rows }) => (
            <div key={date}>
              <div className="mb-1.5 flex items-baseline gap-2">
                <h2 className="text-sm font-bold text-[var(--text)]">{dayLabel(date)}</h2>
                <span className="text-[11px] text-[var(--text-4)]">{rows.length} {rows.length === 1 ? "reporter" : "reporters"}</span>
              </div>
              <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
                <table className="w-full min-w-[720px] text-left text-[13px]">
                  <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
                    <tr>
                      <th className="px-3 py-1.5 font-medium">Ticker</th>
                      <th className="px-2 py-1.5 font-medium">Sector</th>
                      <th className="px-2 py-1.5 text-center font-medium" title="Before the open / after the close">When</th>
                      <th className="px-2 py-1.5 text-right font-medium">Expected move<InfoDot term="Expected move" /></th>
                      <th className="px-2 py-1.5 text-right font-medium" title="This name's average post-earnings 1-day move">Typical</th>
                      <th className="px-2 py-1.5 text-center font-medium">Rich / cheap<InfoDot term="Rich / cheap" /></th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const rt = reliable(r) ? richTag(r.richness) : null;
                      const tm = timing(r.earningsDate);
                      return (
                        <tr key={r.symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                          <td className="px-3 py-1.5">
                            <Link href={`/u/${universe}/stock/${r.symbol}?tab=earnings`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                            {r.earningsEstimate && <span className="ml-1 rounded bg-[#f59e0b]/15 px-1 text-[9px] font-semibold uppercase text-[#f59e0b]" title="Report date is a Yahoo estimate, not company-confirmed">est</span>}
                            <div className="max-w-[150px] truncate text-[11px] text-[var(--text-4)]">{r.name}</div>
                          </td>
                          <td className="px-2 py-1.5 text-[12px] text-[var(--text-3)]">{r.sector}</td>
                          <td className="px-2 py-1.5 text-center text-[11px] text-[var(--text-4)]">{tm || "—"}</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums font-semibold text-[var(--text)]">±{r.impliedMovePct.toFixed(1)}%</td>
                          <td className="px-2 py-1.5 text-right font-mono tabular-nums text-[var(--text-4)]">{r.histAvgMovePct != null ? `±${r.histAvgMovePct.toFixed(1)}%` : "—"}{r.histN ? <span className="text-[10px]"> (n{r.histN})</span> : null}</td>
                          <td className="px-2 py-1.5 text-center">
                            {rt ? <span className="rounded px-1.5 py-0.5 text-[11px] font-semibold" style={{ color: rt.c, background: `color-mix(in oklab, ${rt.c} 14%, transparent)` }}>{rt.t}</span> : <span className="text-[11px] text-[var(--text-4)]">—</span>}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
