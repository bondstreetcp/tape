"use client";
import InfoDot from "./InfoDot";
import { premColor, premVerdict, type VolDisRow } from "@/lib/volDislocation";

const asPct = (v: number | null | undefined) => (v == null ? "—" : `${(v * 100).toFixed(0)}%`);
const skewColor = (s: number | null | undefined) => (s == null ? "var(--text-3)" : s > 0.02 ? "#ef4444" : s < -0.02 ? "#22c55e" : "var(--text-3)");
// Universe percentile → rich (red/amber) at the top, cheap (teal) at the bottom.
const pctileColor = (p: number) => (p >= 80 ? "#ef4444" : p >= 60 ? "#f59e0b" : p <= 20 ? "#14b8a6" : p <= 40 ? "#2dd4bf" : "var(--text-2)");

function Stat({ label, value, color, tip }: { label: string; value: string; color?: string; tip?: string }) {
  return (
    <div className="min-w-[68px]">
      <div className="text-[10px] uppercase tracking-wide text-[var(--text-4)]">{label}{tip && <InfoDot text={tip} />}</div>
      <div className="font-mono text-sm font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}

// Cross-sectional vol context for a name's Options tab: where THIS name's option vol prices vs the
// scanned universe and its sector — the rich/cheap read the skew & term curves above don't give. Fed by
// the single vol-dislocation row for the symbol (server-loaded on the stock page); the parent renders it
// only when the name is in the scan, so there's no empty state here.
export default function VolContext({ row, disp }: { row: VolDisRow; disp?: { indexIV: number } | null }) {
  const verdict = premVerdict(row.ivPremium);
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="text-sm font-semibold text-[var(--text)]">
          Vol vs peers<InfoDot text="Where this name's option vol prices relative to the scanned universe and its sector — the cross-sectional rich/cheap read the skew & term curves don't show. From the nightly vol-dislocation scan." />{" "}
          <span className="font-normal" style={{ color: premColor(row.ivPremium) }}>· vol looks {verdict}</span>
        </h3>
        <div className="flex items-center gap-1.5">
          {row.illiquid && <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[var(--text-4)]" title="Thin options — treat this vol read with caution.">thin</span>}
          {row.earningsDriven && <span className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 text-[11px] text-[#f59e0b]" title={`Reports in ~${row.daysToEarnings}d — rich vol into a print is expected event premium, not a dislocation.`}>earnings {row.daysToEarnings}d</span>}
        </div>
      </div>
      <div className="flex flex-wrap gap-x-6 gap-y-2">
        <Stat label="IV / RV" value={`${row.ivPremium.toFixed(2)}×`} color={premColor(row.ivPremium)} tip="ATM implied vol ÷ realized vol — the variance premium. ≥1.4 rich, ≤1.1 cheap." />
        <Stat label="ATM IV" value={asPct(row.atmIV)} />
        <Stat label="Realized" value={asPct(row.rvol)} />
        {disp && <Stat label="vs index" value={`${row.atmIV - disp.indexIV >= 0 ? "+" : ""}${((row.atmIV - disp.indexIV) * 100).toFixed(0)}`} color={row.atmIV - disp.indexIV >= 0.05 ? "#f59e0b" : row.atmIV - disp.indexIV <= -0.05 ? "#14b8a6" : "var(--text-3)"} tip="This name's ATM IV minus the index's (VIX), in vol points. Positive = it carries more vol than the index — a net contributor to dispersion (what a dispersion trade owns via the single names). Dispersion is inherently cross-sectional, so read this as a rough contribution, not an exact per-name P&L." />}
        <Stat label="Univ pctile" value={`${row.pctile.toFixed(0)}th`} color={pctileColor(row.pctile)} tip="Where this name's variance premium ranks across the scanned universe (100th = richest vol of all)." />
        <Stat label="vs sector" value={row.vsSector != null ? `${row.vsSector > 0 ? "+" : ""}${row.vsSector.toFixed(2)}` : "—"} color={row.vsSector != null ? (row.vsSector >= 0.25 ? "#f59e0b" : row.vsSector <= -0.25 ? "#14b8a6" : "var(--text-3)") : undefined} tip="Richer (+) or cheaper (−) than the median variance premium across its sector." />
        <Stat label="Skew" value={row.skew != null ? `${row.skew > 0 ? "+" : ""}${(row.skew * 100).toFixed(0)}` : "—"} color={skewColor(row.skew)} tip="Front put IV − call IV (vol pts). Positive = downside is bid (put demand / crash-hedged)." />
        <Stat label="Term" value={row.termCrush != null ? row.termCrush.toFixed(2) : "—"} color={row.termCrush != null && row.termCrush >= 1.1 ? "#f59e0b" : "var(--text-3)"} tip="Front-tenor IV ÷ back-tenor IV. >1 = backwardated (event-loaded front, e.g. earnings)." />
      </div>
    </div>
  );
}
