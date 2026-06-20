"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { CurvePoint, MacroInd } from "@/lib/fred";
import type { EconEvent } from "@/lib/econCalendar";
import { fmtDateTime } from "@/lib/format";

const VBW = 1000, MT = 22, MB = 24, ML = 44, MR = 14, H = 300;
const PH = H - MT - MB;

function YieldCurve({ curve }: { curve: CurvePoint[] }) {
  const pts = curve.filter((c) => c.now != null);
  if (pts.length < 2) return <div className="py-8 text-center text-sm text-[var(--text-3)]">Yield-curve data unavailable.</div>;
  const n = curve.length;
  const vals: number[] = [];
  for (const c of curve) for (const v of [c.now, c.monthAgo, c.yearAgo]) if (v != null) vals.push(v);
  let yMin = Math.min(...vals), yMax = Math.max(...vals);
  const pad = (yMax - yMin) * 0.12 || 0.2;
  yMin -= pad; yMax += pad;
  const x = (i: number) => ML + (i / (n - 1)) * (VBW - ML - MR);
  const y = (v: number) => MT + (1 - (v - yMin) / (yMax - yMin || 1)) * PH;

  const linePath = (key: "now" | "monthAgo" | "yearAgo") => {
    let p = "";
    curve.forEach((c, i) => {
      const v = c[key];
      if (v == null) return;
      p += `${p ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`;
    });
    return p;
  };

  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
    const v = yMin + f * (yMax - yMin);
    return { y: y(v), label: `${v.toFixed(1)}%` };
  });

  return (
    <svg viewBox={`0 0 ${VBW} ${H}`} className="w-full" style={{ height: "auto" }}>
      {yTicks.map((t, i) => (
        <g key={i}>
          <line x1={ML} x2={VBW - MR} y1={t.y} y2={t.y} stroke="var(--surface-hover)" />
          <text x={ML - 6} y={t.y + 3} textAnchor="end" fontSize={10} fill="var(--text-4)">{t.label}</text>
        </g>
      ))}
      {curve.map((c, i) => (
        <text key={c.label} x={x(i)} y={H - 7} textAnchor="middle" fontSize={10} fill="var(--text-4)">{c.label}</text>
      ))}
      <path d={linePath("yearAgo")} fill="none" stroke="var(--border-strong)" strokeWidth={1.2} />
      <path d={linePath("monthAgo")} fill="none" stroke="var(--text-3)" strokeWidth={1.2} strokeDasharray="4 3" />
      <path d={linePath("now")} fill="none" stroke="#60a5fa" strokeWidth={2} />
      {curve.map((c, i) =>
        c.now == null ? null : (
          <g key={c.label}>
            <circle cx={x(i)} cy={y(c.now)} r={2.6} fill="#60a5fa" />
            <text x={x(i)} y={y(c.now) - 7} textAnchor="middle" fontSize={9} fill="var(--text-2)">{c.now.toFixed(2)}</text>
          </g>
        ),
      )}
    </svg>
  );
}

function IndCard({ ind }: { ind: MacroInd }) {
  const neg = ind.key === "t102" && ind.value != null && ind.value < 0;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="text-xs text-[var(--text-3)]">{ind.label}</div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums" style={{ color: neg ? "#ef4444" : "var(--text)" }}>
        {ind.value == null ? "—" : `${ind.value >= 0 && ind.unit === "pp" ? "+" : ""}${ind.value.toFixed(2)}${ind.unit === "pp" ? " pp" : "%"}`}
      </div>
      <div className="text-[10px] text-[var(--text-4)]">{ind.asOf ?? ""}{neg ? " · inverted" : ""}</div>
    </div>
  );
}

export default function MacroDashboard({
  curve,
  indicators,
  asOf,
  calendar,
  keyConfigured,
}: {
  curve: CurvePoint[];
  indicators: MacroInd[];
  asOf: string;
  calendar: EconEvent[];
  keyConfigured: boolean;
}) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const groups = [...new Set(indicators.map((i) => i.group))];
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Macro Dashboard</h1>
          <p className="mt-1 text-xs text-[var(--text-3)]">
            U.S. rates, inflation, growth &amp; credit · data from FRED (St. Louis Fed) · as of {fmtDateTime(asOf)}
          </p>
        </div>
        <button
          onClick={() => { setRefreshing(true); router.refresh(); setTimeout(() => setRefreshing(false), 1200); }}
          disabled={refreshing}
          className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text-2)] hover:border-[var(--border-strong)] disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </header>

      <section className="mb-6 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--text-3)]">U.S. Treasury Yield Curve</h2>
          <div className="flex items-center gap-3 text-[11px] text-[var(--text-3)]">
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: "#60a5fa" }} /> now</span>
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4 border-t border-dashed border-[var(--text-3)]" /> 1mo ago</span>
            <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: "var(--border-strong)" }} /> 1yr ago</span>
          </div>
        </div>
        <YieldCurve curve={curve} />
      </section>

      {groups.map((g) => (
        <section key={g} className="mb-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--text-3)]">{g}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {indicators.filter((i) => i.group === g).map((i) => <IndCard key={i.key} ind={i} />)}
          </div>
        </section>
      ))}

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-2)]">Upcoming US economic releases</h2>
        {calendar.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-[var(--text-3)]">No upcoming releases found.</div>
        ) : (
          <>
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              {calendar.map((e, i) => (
                <div key={i} className="flex items-center justify-between border-b border-[var(--divider)] px-4 py-2 text-sm last:border-0">
                  <span className="text-[var(--text)]">
                    {e.label}
                    {e.approx && <span className="ml-1 text-[11px] text-[var(--text-4)]" title="Approximate — typical release date">≈</span>}
                  </span>
                  <span className="tabular-nums text-[var(--text-3)]">
                    {new Date(e.date + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}
                  </span>
                </div>
              ))}
            </div>
            {!keyConfigured && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-4)]">
                Jobless claims &amp; the jobs report are exact; <span className="text-[var(--text-3)]">≈</span> marks dates estimated from each release&apos;s typical schedule. Add a free{" "}
                <a href="https://fredaccount.stlouisfed.org/apikeys" target="_blank" rel="noreferrer" className="text-[#60a5fa] hover:underline">FRED_API_KEY</a> for exact release dates.
              </p>
            )}
          </>
        )}
      </section>

      <p className="mt-2 text-[11px] text-[var(--text-4)]">
        Source: Federal Reserve Economic Data (FRED). Spreads in percentage points; OAS = option-adjusted spread.
      </p>
    </main>
  );
}
