"use client";
import type { CompanyStats } from "@/lib/companyStats";

const shares = (v: number | null | undefined) =>
  v == null ? "—" : v >= 1e9 ? `${(v / 1e9).toFixed(2)}B` : v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : `${v.toFixed(0)}`;
const pct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(1)}%`);

export default function ShortInterestPanel({ stats }: { stats: CompanyStats | null }) {
  const s = stats;
  if (!s || (s.sharesShort == null && s.shortPercentOfFloat == null)) return null;

  const pctFloat = s.shortPercentOfFloat ?? (s.sharesShort != null && s.floatShares ? s.sharesShort / s.floatShares : null);
  const mom =
    s.sharesShort != null && s.sharesShortPriorMonth != null && s.sharesShortPriorMonth > 0
      ? s.sharesShort / s.sharesShortPriorMonth - 1
      : null;

  const note = (() => {
    const bits: string[] = [];
    if (pctFloat != null) bits.push(pctFloat > 0.2 ? "very high short interest" : pctFloat > 0.1 ? "elevated short interest" : pctFloat > 0.05 ? "moderate short interest" : "light short interest");
    if (mom != null && Math.abs(mom) >= 0.03) bits.push(mom > 0 ? `shorts added ${(mom * 100).toFixed(0)}% MoM` : `shorts covered ${(-mom * 100).toFixed(0)}% MoM`);
    if (s.shortRatio != null && s.shortRatio >= 5) bits.push(`~${s.shortRatio.toFixed(0)} days to cover (squeeze risk)`);
    return bits.join(" · ");
  })();

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <h3 className="mb-2 text-sm font-semibold text-[var(--text-2)]">Short interest</h3>
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Stat label="% of float" value={pct(pctFloat)} color={pctFloat != null && pctFloat > 0.1 ? "#f59e0b" : undefined} />
        <Stat label="Days to cover" value={s.shortRatio == null ? "—" : s.shortRatio.toFixed(1)} />
        <Stat label="Shares short" value={shares(s.sharesShort)} sub={mom == null ? undefined : `${mom >= 0 ? "+" : ""}${(mom * 100).toFixed(0)}% MoM`} subColor={mom == null ? undefined : mom >= 0 ? "#ef4444" : "#22c55e"} />
        <Stat label="Float" value={shares(s.floatShares)} />
      </div>
      {note && <p className="mt-2 text-[11px] text-[var(--text-3)]">{note}.</p>}
      <p className="mt-1 text-[10px] text-[var(--text-4)]">Short % of float and days-to-cover from the latest exchange settlement (via Yahoo); MoM compares the two most recent reports.</p>
    </section>
  );
}

function Stat({ label, value, sub, color, subColor }: { label: string; value: string; sub?: string; color?: string; subColor?: string }) {
  return (
    <div>
      <div className="text-[11px] text-[var(--text-4)]">{label}</div>
      <div className="font-mono text-base font-semibold tabular-nums" style={{ color: color ?? "var(--text)" }}>{value}</div>
      {sub && <div className="text-[10px] tabular-nums" style={{ color: subColor ?? "var(--text-4)" }}>{sub}</div>}
    </div>
  );
}
