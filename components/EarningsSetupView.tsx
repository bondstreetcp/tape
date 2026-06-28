"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import type { EarningsMoveRow } from "@/lib/earningsMove";
import { UNIVERSE_BY_ID } from "@/lib/universes";

const money = (v: number | null) =>
  v == null ? "—" : v >= 1e12 ? `$${(v / 1e12).toFixed(1)}T` : v >= 1e9 ? `$${(v / 1e9).toFixed(0)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`;
const when = (iso: string) => new Date(iso).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

// richness = implied move ÷ mean historical reaction. >1 options dear (sell premium); <1 cheap (buy the move).
function verdict(r: number): { label: string; tone: string; color: string } {
  if (r >= 1.15) return { label: "Rich — options dear", tone: "sell premium", color: "#ef4444" };
  if (r <= 0.85) return { label: "Cheap — options light", tone: "buy the move", color: "#22c55e" };
  return { label: "Fair", tone: "roughly priced", color: "#eab308" };
}

type Filt = "all" | "rich" | "cheap";

export default function EarningsSetupView({ rows, universe, asOf }: { rows: EarningsMoveRow[]; universe: string; asOf: string | null }) {
  const [filt, setFilt] = useState<Filt>("all");
  const cards = useMemo(() => {
    const f = rows.filter((r) => {
      if (r.impliedMovePct == null) return false;
      if (filt === "all") return true;
      if (r.richness == null) return false;
      return filt === "rich" ? r.richness >= 1.15 : r.richness <= 0.85;
    });
    return [...f].sort((a, b) => a.daysToEarnings - b.daysToEarnings);
  }, [rows, filt]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
      <div className="mt-1" />
      <PageHeader
        title="Earnings Setup Cards"
        desc="Names reporting soon, with how the options market is pricing the event vs. how the stock has ACTUALLY moved on past prints. Rich = the straddle costs more than history (premium to sell); cheap = the market's underpricing the move. Decision-support, not advice."
      />

      <div className="mb-4 inline-flex gap-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5 text-xs font-medium">
        {([["all", "All"], ["rich", "Rich (sell premium)"], ["cheap", "Cheap (buy the move)"]] as const).map(([k, lbl]) => (
          <button key={k} onClick={() => setFilt(k)} className={"rounded-md px-2.5 py-1 transition-colors " + (filt === k ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{lbl}</button>
        ))}
      </div>

      <div className="mb-3 text-xs text-[var(--text-4)]">{cards.length} reporting{asOf ? ` · as of ${asOf}` : ""}</div>

      <ul className="grid gap-3 sm:grid-cols-2">
        {cards.map((r) => {
          const implied = r.impliedMovePct ?? 0;
          const hasHist = r.richness != null && r.histAvgMovePct != null;
          const v = hasHist ? verdict(r.richness as number) : null;
          const ratio = r.histAvgMovePct && r.histAvgMovePct > 0 ? Math.min(2, implied / r.histAvgMovePct) : 1;
          return (
            <li key={r.symbol} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 transition-colors hover:border-[var(--border-strong)]">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}?tab=options`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{r.symbol}</Link>
                    <span className="truncate text-sm text-[var(--text-3)]">{r.name}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-[var(--text-4)]">{r.sector || "—"} · {money(r.marketCap)}</div>
                </div>
                <div className="shrink-0 rounded-md bg-[var(--surface-hover)] px-2 py-0.5 text-right text-[11px] text-[var(--text-2)]">
                  {r.daysToEarnings <= 0 ? "today" : `in ${r.daysToEarnings}d`}
                  <div className="text-[10px] text-[var(--text-4)]">{when(r.earningsDate)}</div>
                </div>
              </div>

              <div className="mt-3 flex items-end gap-4">
                <div>
                  <div className="text-[10px] text-[var(--text-4)]">Implied move</div>
                  <div className="font-mono text-xl font-bold tabular-nums text-[var(--text)]">±{implied.toFixed(1)}%</div>
                </div>
                <div>
                  <div className="text-[10px] text-[var(--text-4)]">Avg past move{r.histN ? ` (${r.histN})` : ""}</div>
                  <div className="font-mono text-sm font-semibold tabular-nums text-[var(--text-2)]">
                    {hasHist ? <>±{(r.histAvgMovePct as number).toFixed(1)}% <span className="text-[var(--text-4)]">· max {(r.histMaxMovePct ?? 0).toFixed(0)}%</span></> : <span className="text-[var(--text-4)]">no prior reactions</span>}
                  </div>
                </div>
              </div>
              {/* implied (filled) vs historical-avg */}
              <div className="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-[var(--surface-hover)]">
                <div className="h-full rounded-full" style={{ width: `${(ratio / 2) * 100}%`, background: v?.color ?? "var(--text-4)" }} />
              </div>

              {v && (
                <div className="mt-2.5 flex items-center gap-2 text-[11px]">
                  <span className="rounded-full px-2 py-0.5 font-semibold" style={{ background: `${v.color}22`, color: v.color }}>{v.label}</span>
                  <span className="text-[var(--text-4)]">→ {v.tone}</span>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      {!cards.length && <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">Nothing reporting in that bucket right now.</div>}
    </main>
  );
}
