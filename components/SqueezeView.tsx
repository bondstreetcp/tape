"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { TIER_COLOR, type SqueezeData, type SqueezeTier } from "@/lib/shortSqueeze";

const TIERS: SqueezeTier[] = ["Extreme", "High", "Elevated", "Moderate"];
const pctF = (v: number | null, d = 1) => (v == null ? "—" : `${(v * 100).toFixed(d)}%`);
const signed = (v: number | null, d = 0) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(d)}%`);

export default function SqueezeView({ data, universe }: { data: SqueezeData; universe: string }) {
  const uname = UNIVERSE_BY_ID[universe]?.name ?? universe;
  const [tier, setTier] = useState<SqueezeTier | null>(null);

  const counts = useMemo(() => {
    const c: Record<SqueezeTier, number> = { Extreme: 0, High: 0, Elevated: 0, Moderate: 0 };
    for (const r of data.rows) c[r.tier]++;
    return c;
  }, [data.rows]);
  const rows = useMemo(() => data.rows.filter((r) => !tier || r.tier === tier).slice(0, 150), [data.rows, tier]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {uname}</Link>
      <div className="mt-1" />
      <PageHeader
        title="Short-Squeeze Radar"
        desc="The classic squeeze setup, ranked: short interest as a % of float, days to cover (how long shorts need to buy back), and whether shorts are still rising. Crowded + hard-to-cover + still being pressed = the most squeezable. Open a candidate's stock page for its live borrow cost. US names only — decision-support, not advice."
      />

      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {TIERS.map((t) => (
          <button
            key={t}
            onClick={() => setTier(tier === t ? null : t)}
            className={"rounded-xl border p-3 text-left transition-colors " + (tier === t ? "border-[var(--border-strong)] bg-[var(--surface-hover)]" : "border-[var(--border)] bg-[var(--surface)] hover:border-[var(--border-strong)]")}
          >
            <div className="flex items-center gap-1.5">
              <span className="inline-block h-2 w-2 rounded-full" style={{ background: TIER_COLOR[t] }} />
              <span className="text-xs font-semibold text-[var(--text-2)]">{t}</span>
            </div>
            <div className="mt-1 text-xl font-bold tabular-nums text-[var(--text)]">{counts[t]}</div>
            <div className="text-[10px] text-[var(--text-4)]">{t === "Extreme" ? "≥20% of float" : t === "High" ? "≥10%" : t === "Elevated" ? "≥5%" : "2–5%"}</div>
          </button>
        ))}
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        {tier && <button onClick={() => setTier(null)} className="text-xs text-[var(--text-3)] underline hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} of {data.coverage} · {uname}</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full min-w-[720px] text-xs">
          <thead>
            <tr className="border-b border-[var(--border)] bg-[var(--surface)] text-left text-[var(--text-3)]">
              <th className="px-3 py-2 font-medium">#</th>
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-2 py-2 text-right font-medium">Squeeze</th>
              <th className="px-2 py-2 text-right font-medium" title="Short interest as a % of float">% Float</th>
              <th className="px-2 py-2 text-right font-medium" title="Days to cover = shares short ÷ avg daily volume">DTC</th>
              <th className="px-2 py-2 text-right font-medium" title="Month-over-month change in shares short">Shorts MoM</th>
              <th className="px-3 py-2 text-right font-medium" title="Distance from the 52-week high">% from 52wH</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr key={r.symbol} className="border-b border-[var(--divider)] last:border-0 hover:bg-[var(--surface-hover)]">
                <td className="px-3 py-2 tabular-nums text-[var(--text-4)]">{i + 1}</td>
                <td className="px-3 py-2">
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}`} className="font-mono font-semibold text-[var(--text)] hover:text-[var(--accent)]">{r.symbol}</Link>
                  <span className="ml-2 hidden text-[var(--text-4)] sm:inline">{r.name.length > 22 ? r.name.slice(0, 22) + "…" : r.name}</span>
                  <span className="ml-2 rounded-full px-1.5 py-0.5 text-[9px] font-medium" style={{ color: TIER_COLOR[r.tier], background: TIER_COLOR[r.tier] + "1a" }}>{r.tier}</span>
                </td>
                <td className="px-2 py-2">
                  <div className="flex items-center justify-end gap-1.5">
                    <div className="h-1.5 w-12 overflow-hidden rounded bg-[var(--bg)]">
                      <div className="h-1.5 rounded" style={{ width: `${r.score}%`, background: r.score >= 70 ? "#ef4444" : r.score >= 40 ? "#f59e0b" : "#8b93a7" }} />
                    </div>
                    <span className="w-6 text-right font-mono tabular-nums text-[var(--text-2)]">{r.score}</span>
                  </div>
                </td>
                <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: TIER_COLOR[r.tier] }}>{pctF(r.shortPctFloat)}</td>
                <td className="px-2 py-2 text-right tabular-nums text-[var(--text-2)]">{r.daysToCover == null ? "—" : `${r.daysToCover.toFixed(1)}d`}</td>
                <td className="px-2 py-2 text-right tabular-nums" style={{ color: r.shortMomPct == null ? "var(--text-3)" : r.shortMomPct > 0 ? "#ef4444" : "#22c55e" }}>{signed(r.shortMomPct)}</td>
                <td className="px-3 py-2 text-right tabular-nums text-[var(--text-3)]">{signed(r.pctFromHigh)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-[11px] text-[var(--text-4)]">Squeeze score = blended percentile of short %float (50%), days-to-cover (30%) and rising shorts (20%). Short interest from Yahoo via data/estimates.json{data.asOf ? ` · as of ${data.asOf}` : ""} (US only). Rising shorts (red MoM) = more fuel but also more conviction against the name — not investment advice.</p>
    </main>
  );
}
