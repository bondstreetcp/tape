"use client";
import { useMemo, useState } from "react";
import Link from "next/link";
import type { VolDisData } from "@/lib/volDislocation";
import { premColor, premVerdict, sellPremiumScore, sellScoreColor } from "@/lib/volDislocation";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";
import UniverseSwitcher from "./UniverseSwitcher";
import InfoDot from "./InfoDot";

type Side = "all" | "puts" | "calls";

// The Sell-Premium Board — one composite score over the same nightly vol-dislocation dataset the
// /vol-dislocation, /skew and /term-structure screens read, but ranked for the decision a premium
// SELLER actually makes: where to put wheel / CSP / covered-call capital right now. See sellPremiumScore.
export default function SellPremiumView({ universe, data }: { universe: string; data: VolDisData }) {
  const [side, setSide] = useState<Side>("all");
  const [clear, setClear] = useState(false); // 🛡 hide names whose rich vol is just an imminent earnings event
  const [q, setQ] = useState("");

  // Score every liquid name once (thin options can't be sold into, so drop them like the other screens).
  const scored = useMemo(
    () => data.rows.filter((r) => !r.illiquid).map((r) => ({ r, s: sellPremiumScore(r) })),
    [data.rows],
  );
  const cleanN = scored.filter((x) => !x.s.earningsTrap).length;
  const rows = useMemo(() => {
    const ql = q.trim().toLowerCase();
    return scored
      .filter(({ r, s }) => {
        if (clear && s.earningsTrap) return false;
        if (side === "puts" && s.side !== "puts") return false;
        if (side === "calls" && s.side !== "calls") return false;
        if (ql && !r.symbol.toLowerCase().includes(ql) && !r.name.toLowerCase().includes(ql)) return false;
        return true;
      })
      .sort((a, b) => b.s.score - a.s.score || b.r.ivPremium - a.r.ivPremium);
  }, [scored, side, clear, q]);

  const TB = (a: boolean) => "rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (a ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]");
  const pct = (x: number | null) => (x == null ? "—" : `${(x * 100).toFixed(0)}%`);
  const sideLabel = (s: "puts" | "calls" | "either") => (s === "puts" ? "puts richer" : s === "calls" ? "calls richer" : "balanced");
  const sideColor = (s: "puts" | "calls" | "either") => (s === "puts" ? "#f59e0b" : s === "calls" ? "#14b8a6" : "var(--text-3)");

  return (
    <main className="mx-auto max-w-[84rem] px-4 py-6 sm:px-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}</Link>
          <h1 className="mt-1 text-2xl font-bold">Sell-Premium Board — where to sell option premium now</h1>
          <p className="mt-1 max-w-3xl text-[13px] text-[var(--text-3)]">
            One <b>composite sell score</b> that blends the three vol lenses on a single ranking: the <b>variance premium</b> <InfoDot term="IV / RV" /> (IV vs the name&apos;s own realized), its <b>IV rank</b> <InfoDot term="IV rank" /> (rich vs where its vol usually sits), and how rich it is <b>vs its sector</b> — then haircuts names whose rich vol is just an imminent earnings event you&apos;d be short into. The decision layer over Vol&nbsp;Dislocation / Skew / Term&nbsp;Structure. {cleanN} clear of earnings · {fmtDateTime(data.generatedAt)}
          </p>
        </div>
        <UniverseSwitcher current={universe} />
      </div>

      <div className="mb-3 flex flex-wrap items-center gap-2">
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          <button onClick={() => setSide("all")} className={TB(side === "all")}>Both sides</button>
          <button onClick={() => setSide("puts")} className={TB(side === "puts")} title="Skew says puts are the richer sell — the wheel's entry leg">Puts richer</button>
          <button onClick={() => setSide("calls")} className={TB(side === "calls")} title="Skew says calls are the richer sell — overwrite / covered calls">Calls richer</button>
        </div>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2.5 py-1.5 text-xs text-[var(--text-2)]" title="Hide names whose rich vol is just pricing an imminent earnings event inside the front expiry">
          <input type="checkbox" checked={clear} onChange={(e) => setClear(e.target.checked)} /> 🛡 Clear of earnings
        </label>
        <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ticker or company…" className="w-48 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-1.5 text-sm outline-none placeholder:text-[var(--text-4)]" />
        {q && <button onClick={() => setQ("")} className="text-xs text-[var(--text-3)] hover:text-[var(--text)]">clear</button>}
        <span className="ml-auto text-xs text-[var(--text-4)]">{rows.length} names</span>
      </div>

      <div className="mb-3 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-4 py-2 text-[11px] text-[var(--text-4)]">
        <b>Sell score</b> = 0.45·variance-premium + 0.30·IV-rank + 0.25·vs-sector (re-weighted when IV-rank/sector aren&apos;t available), then ×0.45 if earnings sit inside the front expiry — rich vol there is the market paying for a known event, not a free dislocation. Rows link to the name&apos;s <b>Wheel</b> tab to size the actual strike &amp; expiry. Decision support, not advice.
      </div>

      <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        <table className="w-full min-w-[900px] text-left text-[13px]">
          <thead className="border-b border-[var(--border)] text-[11px] uppercase tracking-wide text-[var(--text-4)]">
            <tr>
              <th className="px-3 py-2 font-medium">Ticker</th>
              <th className="px-2 py-2 font-medium">Sector</th>
              <th className="px-2 py-2 text-right font-medium" title="Composite: variance premium + IV rank + vs-sector, earnings-trap-haircut. Higher = better premium sell.">Sell score</th>
              <th className="px-2 py-2 text-right font-medium" title="ATM IV ÷ realized vol — the variance premium">IV / RV<InfoDot term="IV / RV" /></th>
              <th className="px-2 py-2 text-right font-medium" title="Where current IV sits in this name's own history (accrues over time)">IV rank<InfoDot term="IV rank" /></th>
              <th className="px-2 py-2 text-right font-medium" title="Variance premium minus its sector median — peer-relative richness">vs sector</th>
              <th className="px-2 py-2 text-right font-medium">ATM IV<InfoDot term="ATM" /></th>
              <th className="px-2 py-2 font-medium" title="Which side the skew says is the richer sell">Richer side<InfoDot term="Skew" /></th>
              <th className="px-2 py-2 whitespace-nowrap font-medium">Next earnings</th>
              <th className="px-2 py-2 text-right font-medium"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ r, s }) => (
              <tr key={r.symbol} className="border-b border-[var(--border)] last:border-0 hover:bg-[var(--surface-2)]">
                <td className="px-3 py-2">
                  <Link href={`/u/${universe}/stock/${r.symbol}`} className="font-semibold text-[var(--accent)] hover:underline">{r.symbol}</Link>
                  <div className="max-w-[160px] truncate text-[11px] text-[var(--text-4)]">{r.name}</div>
                  {r.catalyst && (
                    <div className="mt-0.5 max-w-[190px] truncate text-[11px]" style={{ color: r.catalyst.kind === "event" ? "#f59e0b" : "var(--text-4)" }} title={`AI read of recent headlines (${Math.round(r.catalyst.confidence * 100)}% conf)`}>⚡ {r.catalyst.text}</div>
                  )}
                </td>
                <td className="px-2 py-2 text-[12px] text-[var(--text-3)]">{r.sector}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-base font-bold" style={{ color: sellScoreColor(s.score) }} title={s.drivers.length ? s.drivers.join(" · ") : undefined}>{s.score}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums font-semibold" style={{ color: premColor(r.ivPremium) }} title={premVerdict(r.ivPremium)}>{r.ivPremium.toFixed(2)}×</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{r.ivRank != null ? `${Math.round(r.ivRank)}ᵗʰ` : "—"}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums" style={{ color: r.vsSector == null ? "var(--text-4)" : r.vsSector >= 0 ? "#22c55e" : "var(--text-3)" }}>{r.vsSector == null ? "—" : `${r.vsSector >= 0 ? "+" : ""}${r.vsSector.toFixed(2)}`}</td>
                <td className="px-2 py-2 text-right font-mono tabular-nums text-[var(--text-2)]">{pct(r.atmIV)}</td>
                <td className="px-2 py-2 text-[12px] font-medium" style={{ color: sideColor(s.side) }}>{sideLabel(s.side)}</td>
                <td className="px-2 py-2 whitespace-nowrap text-[11px]">
                  {s.earningsTrap && r.daysToEarnings != null ? <span className="rounded bg-[#f59e0b]/15 px-1.5 py-0.5 font-semibold text-[#f59e0b]" title="Reports inside the front expiry — the rich vol is pricing this event; the score is haircut">⚠ earnings {r.daysToEarnings}d</span> : r.daysToEarnings != null && r.daysToEarnings >= 0 ? <span className="text-[var(--text-4)]">{r.daysToEarnings}d</span> : <span className="text-[var(--text-4)]">—</span>}
                </td>
                <td className="px-2 py-2 text-right">
                  <Link href={`/u/${universe}/stock/${r.symbol}?tab=wheel`} className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-medium text-[var(--accent)] hover:border-[var(--border-strong)]" title="Size the actual strike & expiry on the Wheel tab">sell →</Link>
                </td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={10} className="px-3 py-8 text-center text-[var(--text-4)]">No names match.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
