interface Pt { label: string; value: number }

/** Small term-structure / futures-curve line chart for labelled points. */
export default function CurveChart({ points, color, unit, title, subtitle, id }: { points: Pt[]; color: string; unit?: string; title: string; subtitle?: string; id: string }) {
  if (!points || points.length < 2) return null;
  const W = 480, H = 180, ML = 44, MR = 14, MT = 14, MB = 26;
  const n = points.length;
  const vals = points.map((p) => p.value);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.15 || Math.abs(hi) * 0.05 || 1;
  lo -= pad; hi += pad;
  const x = (i: number) => ML + (i / Math.max(1, n - 1)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - lo) / (hi - lo || 1)) * (H - MT - MB);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p.value).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)} ${(H - MB).toFixed(1)}L${x(0).toFixed(1)} ${(H - MB).toFixed(1)}Z`;
  const yvals = Array.from({ length: 4 }, (_, i) => lo + (i / 3) * (hi - lo));
  const slope = points[n - 1].value - points[0].value;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">{title}</h3>
        <span className="text-[11px] text-[var(--text-3)]">{slope >= 0 ? "upward · contango" : "downward · backwardation"}</span>
      </div>
      {subtitle && <p className="mb-1 text-[11px] text-[var(--text-4)]">{subtitle}</p>}
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
        {yvals.map((v, i) => (
          <g key={i}>
            <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="var(--surface-hover)" strokeWidth={1} />
            <text x={ML - 5} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-4)">{v.toFixed(v < 10 ? 1 : 0)}{unit || ""}</text>
          </g>
        ))}
        {points.map((p, i) => (
          <text key={i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--text-4)">{p.label}</text>
        ))}
        <defs>
          <linearGradient id={`cg-${id}`} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.18} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#cg-${id})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={1.8} />
        {points.map((p, i) => <circle key={i} cx={x(i)} cy={y(p.value)} r={2.5} fill={color} />)}
      </svg>
    </section>
  );
}
