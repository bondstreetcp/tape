"use client";
import { useEffect, useState } from "react";
import type { CompanyStats } from "@/lib/companyStats";

interface PrepExtras {
  reaction: { avgAbsMove: number; maxAbsMove: number; upRate: number; n: number } | null;
  impliedMove: number | null; // already a percent (e.g. 7.8)
  whatMatters: { debates: string[]; bull: string; bear: string } | null;
}

const pp = (v: number | null | undefined, d = 1) => (v == null ? "—" : `${v >= 0 ? "+" : ""}${(v * 100).toFixed(d)}%`); // decimal → %
const fmtRev = (v: number | null | undefined) => (v == null ? "—" : v >= 1e9 ? `$${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `$${(v / 1e6).toFixed(0)}M` : `$${v}`);

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div>
      <div className="text-[10px] text-[var(--text-4)]">{label}</div>
      <div className="font-mono text-lg font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
      {sub && <div className="text-[10px] leading-tight text-[var(--text-3)]">{sub}</div>}
    </div>
  );
}

// Earnings prep brief — the bar (consensus), estimate momentum, the setup into the print, and a
// GLM "what matters this quarter". Deterministic parts paint from the stats the page already has;
// reaction + implied move + the AI read load lazily.
export default function EarningsPrep({ symbol, stats, earningsDate }: { symbol: string; stats: CompanyStats | null; earningsDate?: string | null }) {
  const [extras, setExtras] = useState<PrepExtras | null | "loading">("loading");
  useEffect(() => {
    let a = true;
    setExtras("loading");
    fetch(`/api/earnings-prep/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => a && setExtras(d.prep || null))
      .catch(() => a && setExtras(null));
    return () => { a = false; };
  }, [symbol]);

  if (!stats) return null;
  const q0 = stats.estimates?.find((e) => e.period === "0q") || stats.estimates?.[0] || null;
  const days = earningsDate ? Math.round((Date.parse(earningsDate) - Date.now()) / 86_400_000) : null;
  const dateLabel = earningsDate && !Number.isNaN(Date.parse(earningsDate)) ? new Date(earningsDate).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  const revPct = q0 && q0.epsCurrent != null && q0.eps90dAgo != null && q0.eps90dAgo !== 0 ? (q0.epsCurrent / q0.eps90dAgo - 1) * 100 : null;
  const sp = stats.surprises.map((s) => s.surprisePercent).filter((x): x is number => x != null);
  const beatRate = sp.length ? sp.filter((x) => x > 0).length / sp.length : null;
  const avgSurprise = sp.length ? sp.reduce((a, x) => a + x, 0) / sp.length : null;

  const ex = typeof extras === "object" ? extras : null;
  const wm = ex?.whatMatters;

  return (
    <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text)]">Earnings prep</h3>
        {dateLabel && (
          <span className="text-xs text-[var(--text-3)]">{days != null && days >= 0 ? `reports ${dateLabel} · in ${days}d` : `next/last report ${dateLabel}`}</span>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Consensus EPS (this Q)" value={q0?.epsAvg != null ? `$${q0.epsAvg.toFixed(2)}` : "—"} sub={q0?.epsAnalysts && q0.epsLow != null && q0.epsHigh != null ? `${q0.epsAnalysts} analysts · $${q0.epsLow.toFixed(2)}–$${q0.epsHigh.toFixed(2)}` : undefined} />
        <Stat label="Consensus revenue" value={fmtRev(q0?.revAvg)} sub={q0?.growth != null ? `${pp(q0.growth, 0)} YoY` : undefined} />
        <Stat label="Estimate trend (90d)" value={revPct != null ? `${revPct >= 0 ? "+" : ""}${revPct.toFixed(1)}%` : "—"} color={revPct != null ? (revPct >= 0 ? "#22c55e" : "#ef4444") : undefined} sub={q0 ? `${q0.epsUp30d ?? 0}↑ / ${q0.epsDown30d ?? 0}↓ revisions (30d)` : undefined} />
        <Stat label="Options-implied move" value={ex?.impliedMove != null ? `±${ex.impliedMove.toFixed(1)}%` : extras === "loading" ? "…" : "—"} sub={ex?.reaction ? `avg past ±${(ex.reaction.avgAbsMove * 100).toFixed(1)}% (${ex.reaction.n} prints)` : undefined} />
      </div>

      <div className="mt-2.5 flex flex-wrap gap-x-5 gap-y-1 text-[11px] text-[var(--text-3)]">
        {beatRate != null && <span><b className="text-[var(--text-2)]">Beat rate</b> {(beatRate * 100).toFixed(0)}% of {sp.length}q{avgSurprise != null ? ` · avg surprise ${pp(avgSurprise, 1)}` : ""}</span>}
        {ex?.reaction && <span><b className="text-[var(--text-2)]">Reaction</b> popped {(ex.reaction.upRate * 100).toFixed(0)}% of the time · max ±{(ex.reaction.maxAbsMove * 100).toFixed(0)}%</span>}
        {stats.forwardPE != null && <span><b className="text-[var(--text-2)]">Fwd P/E</b> {stats.forwardPE.toFixed(0)}</span>}
        {stats.shortPercentOfFloat != null && <span><b className="text-[var(--text-2)]">Short</b> {(stats.shortPercentOfFloat * 100).toFixed(1)}% of float</span>}
      </div>

      <div className="mt-3 border-t border-[var(--divider)] pt-3">
        <div className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-4)]">What matters this quarter</div>
        {extras === "loading" ? (
          <div className="flex items-center gap-2 text-[12px] text-[var(--text-4)]"><span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-[var(--border-strong)] border-t-[var(--accent)]" /> building the prep…</div>
        ) : wm && (wm.debates.length || wm.bull || wm.bear) ? (
          <div className="space-y-1.5 text-[12px] leading-snug">
            {wm.debates.length > 0 && (
              <ul className="space-y-1">{wm.debates.map((d, i) => <li key={i} className="text-[var(--text-2)]"><span className="text-[var(--accent)]">▸</span> {d}</li>)}</ul>
            )}
            {wm.bull && <p><span className="font-semibold text-[#22c55e]">Bull </span><span className="text-[var(--text-2)]">{wm.bull}</span></p>}
            {wm.bear && <p><span className="font-semibold text-[#ef4444]">Bear </span><span className="text-[var(--text-2)]">{wm.bear}</span></p>}
          </div>
        ) : (
          <p className="text-[12px] text-[var(--text-4)]">No AI read available right now.</p>
        )}
      </div>

      <p className="mt-2 text-[10px] leading-relaxed text-[var(--text-4)]">Consensus &amp; revisions via Yahoo; reaction = close-to-close moves on past prints; implied move from the ATM straddle when available. AI context — decision-support, not investment advice.</p>
    </div>
  );
}
