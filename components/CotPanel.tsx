"use client";
import { type CotData, type CotRow, COT_GROUP_ORDER, fmtContracts, crowding } from "@/lib/cot";

const pctColor = (v: number) => (v >= 0 ? "#22c55e" : "#ef4444");

function Spark({ points }: { points: [string, number][] }) {
  if (!points || points.length < 2) return null;
  const vals = points.map((p) => p[1]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const W = 120, H = 28, pad = 2;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad);
  const y = (v: number) => (max === min ? H / 2 : pad + (1 - (v - min) / (max - min)) * (H - 2 * pad));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const zeroY = min < 0 && max > 0 ? y(0) : null;
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0">
      {zeroY != null && <line x1={pad} x2={W - pad} y1={zeroY} y2={zeroY} stroke="var(--divider)" strokeWidth={1} strokeDasharray="2 2" />}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={1.5} strokeLinejoin="round" opacity={0.9} />
    </svg>
  );
}

function Gauge({ pct }: { pct: number }) {
  const c = crowding(pct).color;
  return (
    <div className="mt-1.5">
      <div className="relative h-1.5 rounded-full" style={{ background: "linear-gradient(90deg,#22c55e,var(--surface-2),#ef4444)" }}>
        <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)]" style={{ left: `${Math.max(2, Math.min(98, pct))}%`, background: c }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-[var(--text-4)]"><span>net short</span><span>5yr %ile</span><span>net long</span></div>
    </div>
  );
}

function Card({ r }: { r: CotRow }) {
  const cr = crowding(r.percentile);
  const extreme = r.percentile >= 90 || r.percentile <= 10;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3" style={extreme ? { borderColor: `${cr.color}66` } : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[13px] font-semibold text-[var(--text)]" title={r.label}>{r.label}</div>
          <div className="mt-0.5 flex items-baseline gap-1.5">
            <span className="font-mono text-lg font-bold leading-none tabular-nums" style={{ color: r.specNet >= 0 ? "#22c55e" : "#ef4444" }}>{fmtContracts(r.specNet)}</span>
            <span className="text-[10px] text-[var(--text-4)]">spec net</span>
          </div>
        </div>
        <Spark points={r.history} />
      </div>
      <Gauge pct={r.percentile} />
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
        <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: `${cr.color}22`, color: cr.color }}>
          {cr.label} · {r.percentile.toFixed(0)}%
        </span>
        <span title="Week-over-week change in the speculators net position">
          <b className="text-[var(--text-4)]">WoW</b>{" "}
          <span className="tabular-nums" style={{ color: pctColor(r.wowChange) }}>
            {r.wowChange >= 0 ? "+" : ""}{fmtContracts(r.wowChange)}
          </span>
        </span>
        {r.pctOI != null && (
          <span title="Spec net as a share of open interest">
            <b className="text-[var(--text-4)]">%OI</b>{" "}
            <span className="tabular-nums">{r.pctOI >= 0 ? "+" : ""}{r.pctOI.toFixed(0)}%</span>
          </span>
        )}
      </div>
    </div>
  );
}

export default function CotPanel({ data }: { data: CotData | null }) {
  if (!data || !data.rows.length) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">
        Building the positioning board — populates on the next nightly refresh.
      </div>
    );
  }
  const reportDate = data.reportDate ? new Date(data.reportDate + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
  return (
    <div>
      <p className="mb-4 max-w-3xl text-sm text-[var(--text-3)]">
        Where large speculators (non-commercials) are net long or short the key futures — and, more importantly, how <b className="text-[var(--text-2)]">extreme</b> that positioning is vs its own 5-year range. A crowded extreme is a contrarian flag: crowded longs are fuel for a squeeze lower, crowded shorts for a squeeze higher. {reportDate ? `As of ${reportDate} (CFTC publishes weekly, Fridays).` : ""}
      </p>
      <div className="space-y-4">
        {COT_GROUP_ORDER.map((g) => {
          const rows = data.rows.filter((r) => r.group === g);
          if (!rows.length) return null;
          return (
            <div key={g}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{g}</div>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-4">
                {rows.map((r) => <Card key={r.key} r={r} />)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-[var(--text-4)]">
        Source: CFTC Commitments of Traders (Legacy futures-only), free public data, as-of Tuesday and published Friday. &quot;Spec net&quot; = non-commercial long − short (large speculators / trend-followers); commercials are the hedgers on the other side. The 5-year percentile is the crowding gauge. Positioning is a contrarian/context signal at extremes, not a timing tool — decision-support, not investment advice.
      </p>
    </div>
  );
}
