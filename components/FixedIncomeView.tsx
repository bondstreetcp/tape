"use client";
import Link from "next/link";
import type { CurvePoint, MacroInd } from "@/lib/fred";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { fmtDateTime } from "@/lib/format";

const yld = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);
const bps = (pp: number | null) => (pp == null ? "—" : `${pp >= 0 ? "+" : "−"}${Math.abs(pp * 100).toFixed(0)} bps`);

export default function FixedIncomeView({
  universe, curve, indicators, asOf,
}: { universe: string; curve: CurvePoint[]; indicators: MacroInd[]; asOf: string }) {
  const at = (label: string) => curve.find((c) => c.label === label);
  const sp = (a: string, b: string) => {
    const x = at(a)?.now, y = at(b)?.now;
    return x != null && y != null ? x - y : null;
  };
  const s2s10 = sp("10Y", "2Y"), s3m10 = sp("10Y", "3M"), s5s30 = sp("30Y", "5Y");
  const hy = indicators.find((i) => i.key === "hy");
  const ig = indicators.find((i) => i.key === "ig");

  const inversion = s2s10 == null ? null
    : s2s10 < -0.05 ? { t: "Inverted", c: "#ef4444", note: "Long rates below short rates — historically a recession lead indicator." }
    : s2s10 < 0.10 ? { t: "Flat", c: "#f59e0b", note: "Little compensation for duration — the curve is near flat." }
    : { t: "Upward-sloping", c: "#22c55e", note: "Normal positive term premium." };

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <header className="mb-4">
        <Link href={`/u/${universe}/macro`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">← Economy</Link>
        <h1 className="mt-1 text-2xl font-bold">Rates &amp; Credit</h1>
        <p className="mt-1 text-xs text-[var(--text-3)]">U.S. Treasury yield curve &amp; credit spreads · FRED · as of {fmtDateTime(asOf)}</p>
      </header>

      <section className="mb-4 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-1 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold text-[var(--text-2)]">Treasury yield curve</h2>
          <span className="flex gap-3 text-[11px] text-[var(--text-3)]">
            <span style={{ color: "var(--text)" }}>● now</span>
            <span style={{ color: "#60a5fa" }}>● 1mo ago</span>
            <span style={{ color: "var(--text-4)" }}>● 1yr ago</span>
          </span>
        </div>
        <CurveSvg curve={curve} />
      </section>

      <section className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Spread label="2s10s (10Y − 2Y)" v={s2s10} />
        <Spread label="3m10y (10Y − 3M)" v={s3m10} />
        <Spread label="5s30s (30Y − 5Y)" v={s5s30} />
      </section>

      {inversion && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border px-3 py-2 text-sm" style={{ borderColor: inversion.c + "66", background: inversion.c + "14" }}>
          <span className="font-semibold" style={{ color: inversion.c }}>{inversion.t}</span>
          <span className="text-[var(--text-2)]">{inversion.note}</span>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h2 className="mb-2 text-sm font-semibold text-[var(--text-2)]">Curve by maturity</h2>
          <table className="w-full text-sm">
            <thead>
              <tr className="text-[var(--text-3)]">
                <th className="py-1 text-left font-medium">Tenor</th>
                <th className="py-1 text-right font-medium">Now</th>
                <th className="py-1 text-right font-medium">Δ 1mo</th>
                <th className="py-1 text-right font-medium">Δ 1yr</th>
              </tr>
            </thead>
            <tbody>
              {curve.map((c) => {
                const d1 = c.now != null && c.monthAgo != null ? c.now - c.monthAgo : null;
                const dy = c.now != null && c.yearAgo != null ? c.now - c.yearAgo : null;
                return (
                  <tr key={c.label} className="border-t border-[var(--divider)]">
                    <td className="py-1 text-left font-mono text-[var(--text-2)]">{c.label}</td>
                    <td className="py-1 text-right font-mono tabular-nums">{yld(c.now)}</td>
                    <td className="py-1 text-right tabular-nums" style={{ color: trend(d1) }}>{bps(d1)}</td>
                    <td className="py-1 text-right tabular-nums" style={{ color: trend(dy) }}>{bps(dy)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>

        <section className="space-y-3">
          <Credit ind={ig} label="Investment-grade OAS" hint="Spread over Treasuries on IG corporate bonds." color="#60a5fa" />
          <Credit ind={hy} label="High-yield OAS" hint="Junk-bond spread — the market's risk appetite gauge." color="#f59e0b" />
        </section>
      </div>

      <p className="mt-4 text-[11px] text-[var(--text-4)]">Source: Federal Reserve Economic Data (FRED). Spreads in basis points; OAS = option-adjusted spread. Curve refreshes with the macro snapshot.</p>
    </main>
  );
}

const trend = (v: number | null) => (v == null ? undefined : v > 0.001 ? "#ef4444" : v < -0.001 ? "#22c55e" : "var(--text-3)");

function Spread({ label, v }: { label: string; v: number | null }) {
  const inv = v != null && v < 0;
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3">
      <div className="text-[11px] text-[var(--text-4)]">{label}</div>
      <div className="mt-0.5 font-mono text-xl font-bold tabular-nums" style={{ color: inv ? "#ef4444" : "var(--text)" }}>{bps(v)}</div>
      <div className="text-[11px]" style={{ color: inv ? "#ef4444" : "var(--text-4)" }}>{v == null ? "" : inv ? "inverted" : "positive"}</div>
    </div>
  );
}

function Credit({ ind, label, hint, color }: { ind?: MacroInd; label: string; hint: string; color: string }) {
  const hist = ind?.history ?? [];
  const cur = ind?.value ?? null;
  const vals = hist.map((h) => h[1]);
  const below = cur != null && vals.length ? vals.filter((v) => v <= cur).length / vals.length : null;
  const read = below == null ? null
    : below < 0.3 ? `Tighter than ${Math.round((1 - below) * 100)}% of the past 5 years — risk-on / complacent.`
    : below > 0.7 ? `Wider than ${Math.round(below * 100)}% of the past 5 years — credit stress building.`
    : "Mid-range vs. the past 5 years.";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-[var(--text-2)]">{label}</span>
        <span className="font-mono text-lg font-bold tabular-nums text-[var(--text)]">{cur == null ? "—" : `${cur.toFixed(2)}%`}</span>
      </div>
      <Spark history={hist} color={color} />
      <p className="text-[11px] text-[var(--text-3)]">{read ?? hint}</p>
    </div>
  );
}

function CurveSvg({ curve }: { curve: CurvePoint[] }) {
  const W = 760, H = 240, ML = 40, MR = 14, MT = 14, MB = 26;
  const n = curve.length;
  const vals: number[] = [];
  for (const c of curve) for (const v of [c.now, c.monthAgo, c.yearAgo]) if (v != null) vals.push(v);
  if (vals.length < 2) return <div className="py-8 text-center text-sm text-[var(--text-3)]">Yield-curve data unavailable.</div>;
  let vMin = Math.min(...vals), vMax = Math.max(...vals);
  const pad = (vMax - vMin) * 0.12 || 0.1; vMin -= pad; vMax += pad;
  const x = (i: number) => ML + (i / (n - 1)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - vMin) / (vMax - vMin)) * (H - MT - MB);
  const line = (key: "now" | "monthAgo" | "yearAgo", color: string, dash?: string, w = 1.3) => {
    let p = "";
    curve.forEach((c, i) => { const v = c[key]; if (v != null) p += `${p ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`; });
    return <path d={p} fill="none" stroke={color} strokeWidth={w} strokeDasharray={dash} />;
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
      {[0, 0.25, 0.5, 0.75, 1].map((f, i) => {
        const v = vMin + f * (vMax - vMin);
        return <g key={i}><line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="var(--surface-hover)" /><text x={ML - 6} y={y(v) + 3} textAnchor="end" fontSize={10} fill="var(--text-4)">{v.toFixed(1)}%</text></g>;
      })}
      {line("yearAgo", "var(--text-4)", "3 3")}
      {line("monthAgo", "#60a5fa", "4 2")}
      {line("now", "var(--text)", undefined, 2.2)}
      {curve.map((c, i) => (c.now != null ? <circle key={i} cx={x(i)} cy={y(c.now)} r={2.6} fill="var(--text)" /> : null))}
      {curve.map((c, i) => <text key={"l" + i} x={x(i)} y={H - 8} textAnchor="middle" fontSize={9} fill="var(--text-4)">{c.label}</text>)}
    </svg>
  );
}

function Spark({ history, color }: { history: [string, number][]; color: string }) {
  const W = 260, H = 44;
  const vals = history.map((h) => h[1]);
  if (vals.length < 2) return <div className="h-[44px]" />;
  const min = Math.min(...vals), max = Math.max(...vals);
  const x = (i: number) => (i / (history.length - 1)) * W;
  const y = (v: number) => 3 + (1 - (v - min) / (max - min || 1)) * (H - 6);
  let p = "";
  history.forEach((h, i) => { p += `${p ? "L" : "M"}${x(i).toFixed(1)} ${y(h[1]).toFixed(1)}`; });
  return <svg viewBox={`0 0 ${W} ${H}`} className="my-1.5 w-full" style={{ height: "auto" }}><path d={p} fill="none" stroke={color} strokeWidth={1.5} /></svg>;
}
