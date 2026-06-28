"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import PageHeader from "./PageHeader";
import InfoDot from "./InfoDot";
import type { CefHunterName } from "@/lib/cefHunter";
import { UNIVERSE_BY_ID } from "@/lib/universes";

const num = (v: number | null | undefined, d = 1, suf = "") => (v == null ? "—" : `${v.toFixed(d)}${suf}`);

export default function CefHunterView({ funds, universe }: { funds: CefHunterName[]; universe: string }) {
  const [stretchedOnly, setStretchedOnly] = useState(false);
  const rows = useMemo(() => (stretchedOnly ? funds.filter((f) => f.stretched) : funds).slice(0, 80), [funds, stretchedOnly]);

  return (
    <main className="mx-auto max-w-5xl px-4 py-6 sm:px-6">
      <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
      <div className="mt-1" />
      <PageHeader
        title="CEF Discount Hunter"
        desc="Closed-end funds at the most STRETCHED discounts — cheap versus their own history, not just a big headline discount — ranked by a hunter score that blends discount depth, how unusual it is (z-score), and the distribution yield you collect while waiting. US funds. Decision-support, not advice."
      />

      <div className="mb-4 flex items-center gap-2">
        <button onClick={() => setStretchedOnly((v) => !v)} className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (stretchedOnly ? "bg-[var(--accent-strong)] text-white" : "border border-[var(--border)] text-[var(--text-2)] hover:border-[var(--border-strong)]")}>
          Stretched vs history (z ≤ −1)
        </button>
        <span className="text-xs text-[var(--text-4)]">{rows.length} funds</span>
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-[var(--border)] text-left text-xs text-[var(--text-3)]">
              <th className="px-3 py-2 font-medium">Fund</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 text-right font-medium">Discount</th>
              <th className="px-3 py-2 text-right font-medium">z<InfoDot text="How unusual today's discount is vs the fund's own past year. −1 = a standard deviation cheaper than its norm." /></th>
              <th className="px-3 py-2 text-right font-medium">Yield</th>
              <th className="px-3 py-2 text-right font-medium">Lev.</th>
              <th className="px-3 py-2 text-right font-medium">Exp.</th>
              <th className="px-3 py-2 text-right font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => (
              <tr key={f.ticker} className="border-b border-[var(--divider)] hover:bg-[var(--surface-hover)]">
                <td className="px-3 py-2">
                  <div className="font-mono font-semibold text-[var(--text)]">{f.ticker}</div>
                  <div className="max-w-[16rem] truncate text-[11px] text-[var(--text-4)]">{f.name}</div>
                </td>
                <td className="max-w-[12rem] truncate px-3 py-2 text-xs text-[var(--text-3)]">{f.category}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[#22c55e]">{num(f.discount, 1, "%")}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums">
                  <span style={{ color: f.stretched ? "#22c55e" : "var(--text-2)" }}>{num(f.z1y, 1)}</span>
                  {f.stretched && <span className="ml-1 rounded bg-[var(--accent-soft)] px-1 text-[9px] font-semibold text-[var(--accent)]">stretched</span>}
                </td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{num(f.distRate, 1, "%")}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-4)]">{f.leverage != null ? `${f.leverage.toFixed(0)}%` : "—"}</td>
                <td className="px-3 py-2 text-right font-mono tabular-nums text-[var(--text-4)]">{num(f.expense, 2, "%")}</td>
                <td className="px-3 py-2 text-right font-mono font-semibold tabular-nums text-[var(--accent)]">{f.score.toFixed(1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!rows.length && <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center text-sm text-[var(--text-3)]">No stretched discounts right now — clear the filter.</div>}
    </main>
  );
}
