"use client";
import {
  type EconSurpriseData, type SurpriseEvent, CATEGORY_COLOR,
  surpriseColor, fmtZ, fmtVal, beatMiss,
} from "@/lib/econSurprise";

// Diverging gauge: misses ← 0 → beats, marker at the latest ESI (clamped to a ±5 display range).
function Gauge({ v }: { v: number }) {
  const pct = Math.max(2, Math.min(98, 50 + (Math.max(-5, Math.min(5, v)) / 5) * 48));
  const c = surpriseColor(v);
  return (
    <div className="mt-2 w-full max-w-md">
      <div className="relative h-2 rounded-full" style={{ background: "linear-gradient(90deg,#ef4444,var(--surface-2),#22c55e)" }}>
        <div className="absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)] shadow" style={{ left: `${pct}%`, background: c }} />
        <div className="absolute left-1/2 top-1/2 h-3 w-px -translate-y-1/2 bg-[var(--text-4)]" />
      </div>
      <div className="mt-0.5 flex justify-between text-[10px] text-[var(--text-4)]"><span>data missing</span><span>vs expectations</span><span>data beating</span></div>
    </div>
  );
}

function IndexChart({ index }: { index: [string, number][] }) {
  const n = index.length;
  const W = 720, H = 200, ML = 40, MR = 14, MT = 12, MB = 22;
  const vals = index.map((p) => p[1]);
  let lo = Math.min(0, ...vals), hi = Math.max(0, ...vals);
  const pad = (hi - lo) * 0.12 || 1; lo -= pad; hi += pad;
  const x = (i: number) => ML + (i / Math.max(1, n - 1)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - lo) / (hi - lo || 1)) * (H - MT - MB);
  const line = index.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[1]).toFixed(1)}`).join("");
  const zeroY = y(0);
  const yvals = [lo, (lo + hi) / 2, 0, hi].filter((v, i, a) => a.indexOf(v) === i);
  const years: { i: number; lab: string }[] = [];
  let lm = "";
  index.forEach((p, i) => { const m = p[0].slice(0, 7); if (m !== lm) { years.push({ i, lab: new Date(p[0] + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", year: "2-digit" }) }); lm = m; } });
  const every = Math.ceil(years.length / 8);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
      {yvals.map((v, i) => (
        <g key={i}>
          <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke={v === 0 ? "var(--border-strong)" : "var(--surface-hover)"} strokeWidth={1} />
          <text x={ML - 5} y={y(v) + 3} textAnchor="end" fontSize={9} fill="var(--text-4)" className="tabular-nums">{v.toFixed(1)}</text>
        </g>
      ))}
      {years.filter((_, k) => k % every === 0).map((yr, k) => (
        <text key={k} x={x(yr.i)} y={H - 6} textAnchor="middle" fontSize={9} fill="var(--text-4)">{yr.lab}</text>
      ))}
      <path d={`${line}L${x(n - 1).toFixed(1)} ${zeroY}L${x(0).toFixed(1)} ${zeroY}Z`} fill="var(--accent)" fillOpacity={0.08} />
      <path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx={x(n - 1)} cy={y(index[n - 1][1])} r={2.8} fill="var(--accent)" />
    </svg>
  );
}

function Row({ e }: { e: SurpriseEvent }) {
  const d = new Date(e.date + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "2-digit" });
  return (
    <div className="flex items-center justify-between gap-2 border-b border-[var(--divider)] px-3 py-2 last:border-0">
      <span className="flex min-w-0 items-center gap-2">
        <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: CATEGORY_COLOR[e.category] }} title={e.category} />
        <span className="truncate text-[13px] text-[var(--text)]">{e.label}</span>
        <span className="shrink-0 text-[11px] text-[var(--text-4)]">{d}</span>
      </span>
      <span className="flex shrink-0 items-center gap-3 text-[11px] tabular-nums">
        <span className="hidden text-[var(--text-3)] sm:inline">{fmtVal(e.actual, e.unit)} <span className="text-[var(--text-4)]">vs</span> {fmtVal(e.consensus, e.unit)}</span>
        <span className="w-14 text-right font-semibold" style={{ color: surpriseColor(e.z) }}>{fmtZ(e.z)}</span>
        <span className="w-12 rounded px-1.5 py-0.5 text-center text-[10px] font-semibold uppercase" style={{ background: `${surpriseColor(e.z)}22`, color: surpriseColor(e.z) }}>{beatMiss(e.z)}</span>
      </span>
    </div>
  );
}

export default function EconSurprisePanel({ data }: { data: EconSurpriseData | null }) {
  if (!data || !data.events.length) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-sm text-[var(--text-3)]">
        Building the surprise index — it captures each release as it prints (consensus vs actual), so it fills in over the coming weeks.
      </div>
    );
  }
  const recent = [...data.events].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 16);
  const esi = data.latest ?? 0;
  const label = Math.abs(esi) < 0.3 ? "roughly in line" : esi > 0 ? "data beating expectations" : "data missing expectations";
  const started = new Date(data.startedDate + "T12:00:00Z").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="max-w-2xl text-sm text-[var(--text-3)]">
            How US data is printing versus the consensus — each release&apos;s <b className="text-[var(--text-2)]">surprise</b> (actual − forecast, standardized), summed with a ~90-day decay. Positive = data mostly beating.
          </p>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="font-mono text-3xl font-bold tabular-nums" style={{ color: surpriseColor(esi) }}>{esi > 0 ? "+" : esi < 0 ? "−" : ""}{Math.abs(esi).toFixed(2)}</span>
            <span className="text-sm text-[var(--text-3)]">{label}</span>
          </div>
          <Gauge v={esi} />
        </div>
      </div>

      {data.index.length >= 5 && (
        <div className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Index — trailing standardized surprises</div>
          <IndexChart index={data.index} />
        </div>
      )}

      <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
        <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Recent surprises</div>
        <div className="flex flex-wrap gap-x-3 gap-y-1 text-[10px]">
          {Object.entries(CATEGORY_COLOR).map(([k, c]) => (
            <span key={k} className="flex items-center gap-1 text-[var(--text-4)]"><span className="h-2 w-2 rounded-full" style={{ background: c }} />{k}</span>
          ))}
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
        {recent.map((e) => <Row key={`${e.key}-${e.date}`} e={e} />)}
      </div>

      <p className="mt-3 max-w-3xl text-[11px] leading-relaxed text-[var(--text-4)]">
        Consensus forecasts from ForexFactory matched to actual prints from FRED (St. Louis Fed). Because only the current week&apos;s consensus is published, surprises are captured as releases print — {data.events.length} captured since {started}; the index deepens over time. Jobless claims are sign-flipped (fewer = stronger); inflation prints read as positive when they come in hot. Equal-weighted, ~1σ-scaled per release. Decision-support, not investment advice.
      </p>
    </div>
  );
}
