interface Pt { label: string; now?: number; w1?: number; m1?: number; y1?: number }

type SeriesKey = "now" | "w1" | "m1" | "y1";
const SERIES: { key: SeriesKey; label: string; width: number; opacity: number; dash?: string }[] = [
  { key: "now", label: "now", width: 2, opacity: 1 },
  { key: "w1", label: "1wk ago", width: 1.4, opacity: 0.68 },
  { key: "m1", label: "1mo ago", width: 1.4, opacity: 0.5, dash: "4 3" },
  { key: "y1", label: "1yr ago", width: 1.4, opacity: 0.32, dash: "2 3" },
];

/** Term-structure / futures-curve chart that overlays the curve now and where it
 *  sat 1 week / 1 month / 1 year ago. */
export default function CurveChart({ points, color, unit, title, subtitle, id }: { points: Pt[]; color: string; unit?: string; title: string; subtitle?: string; id: string }) {
  if (!points || points.length < 2 || points.every((p) => p.now == null)) return null;
  const W = 480, H = 190, ML = 44, MR = 14, MT = 14, MB = 26;
  const n = points.length;
  const allVals = points.flatMap((p) => [p.now, p.w1, p.m1, p.y1].filter((v): v is number => v != null));
  let lo = Math.min(...allVals), hi = Math.max(...allVals);
  const pad = (hi - lo) * 0.12 || Math.abs(hi) * 0.05 || 1;
  lo -= pad; hi += pad;
  const x = (i: number) => ML + (i / Math.max(1, n - 1)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - lo) / (hi - lo || 1)) * (H - MT - MB);
  const yvals = Array.from({ length: 4 }, (_, i) => lo + (i / 3) * (hi - lo));

  const pathFor = (key: SeriesKey) => {
    const pts = points.map((p, i) => ({ i, v: p[key] })).filter((p): p is { i: number; v: number } => p.v != null);
    if (pts.length < 2) return "";
    return pts.map((p, k) => `${k ? "L" : "M"}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join("");
  };
  const nowPts = points.map((p, i) => ({ i, v: p.now })).filter((p): p is { i: number; v: number } => p.v != null);
  const nowPath = pathFor("now");
  const area = nowPts.length >= 2 ? `${nowPath}L${x(nowPts[nowPts.length - 1].i).toFixed(1)} ${(H - MB).toFixed(1)}L${x(nowPts[0].i).toFixed(1)} ${(H - MB).toFixed(1)}Z` : "";
  const firstNow = points.find((p) => p.now != null)?.now ?? 0;
  const lastNow = [...points].reverse().find((p) => p.now != null)?.now ?? 0;
  const slope = lastNow - firstNow;

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-0.5 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text-2)]">{title}</h3>
        <span className="text-[11px] text-[var(--text-3)]">{slope >= 0 ? "upward · contango" : "downward · backwardation"}</span>
      </div>
      {subtitle && <p className="mb-1 text-[11px] text-[var(--text-4)]">{subtitle}</p>}
      <div className="mb-1 flex flex-wrap items-center gap-x-3 gap-y-0.5">
        {SERIES.map((s) => (
          <span key={s.key} className="flex items-center gap-1 text-[10px] text-[var(--text-3)]">
            <svg width="14" height="6" aria-hidden>
              <line x1="0" y1="3" x2="14" y2="3" stroke={color} strokeWidth={s.width} strokeOpacity={s.opacity} strokeDasharray={s.dash} />
            </svg>
            {s.label}
          </span>
        ))}
      </div>
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
            <stop offset="0%" stopColor={color} stopOpacity={0.16} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        {area && <path d={area} fill={`url(#cg-${id})`} />}
        {/* historical curves under the current one */}
        {SERIES.filter((s) => s.key !== "now").map((s) => {
          const d = pathFor(s.key);
          return d ? <path key={s.key} d={d} fill="none" stroke={color} strokeWidth={s.width} strokeOpacity={s.opacity} strokeDasharray={s.dash} /> : null;
        })}
        <path d={nowPath} fill="none" stroke={color} strokeWidth={2} />
        {nowPts.map((p) => <circle key={p.i} cx={x(p.i)} cy={y(p.v)} r={2.5} fill={color} />)}
      </svg>
    </section>
  );
}
