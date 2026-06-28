"use client";
import React, { useState, useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import type { CurvePoint, MacroInd } from "@/lib/fred";
import type { EconEvent } from "@/lib/econCalendar";
import type { VolOil } from "@/lib/curves";
import { LABEL_TO_RELEASE, type ReleaseData } from "@/lib/releases";
import type { EconEstimate } from "@/lib/econEstimates";
import { fmtDateTime } from "@/lib/format";
import CurveChart from "./CurveChart";
import CreditSpreads, { type CreditSeries } from "./CreditSpreads";

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

function IndCard({ ind, onOpen }: { ind: MacroInd; onOpen: () => void }) {
  const neg = ind.key === "t102" && ind.value != null && ind.value < 0;
  const has = (ind.history?.length ?? 0) > 1;
  return (
    <button
      onClick={onOpen}
      disabled={!has}
      title={has ? `${ind.label} — view history` : ind.label}
      className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition-colors enabled:hover:border-[var(--border-strong)] disabled:cursor-default"
    >
      <div className="flex items-center justify-between gap-1">
        <div className="text-xs text-[var(--text-3)]">{ind.label}</div>
        {has && <span className="text-[10px] text-[var(--text-4)]">↗</span>}
      </div>
      <div className="mt-1 font-mono text-xl font-semibold tabular-nums" style={{ color: neg ? "#ef4444" : "var(--text)" }}>
        {ind.value == null ? "—" : `${ind.value >= 0 && ind.unit === "pp" ? "+" : ""}${ind.value.toFixed(2)}${ind.unit === "pp" ? " pp" : ind.unit === "%" ? "%" : ""}`}
      </div>
      <div className="text-[10px] text-[var(--text-4)]">{ind.asOf ?? ""}{neg ? " · inverted" : ""}</div>
    </button>
  );
}

function IndicatorDetail({ ind, onClose }: { ind: MacroInd; onClose: () => void }) {
  useEffect(() => {
    const k = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const h = ind.history || [];
  const n = h.length;
  const W = 720, H = 280, ML = 54, MR = 16, MT = 16, MB = 28;
  const vals = h.map((p) => p[1]);
  let lo = Math.min(...vals), hi = Math.max(...vals);
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
  lo -= pad; hi += pad;
  const x = (i: number) => ML + (i / Math.max(1, n - 1)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - lo) / (hi - lo || 1)) * (H - MT - MB);
  const line = h.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(p[1]).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)} ${(H - MB).toFixed(1)}L${x(0).toFixed(1)} ${(H - MB).toFixed(1)}Z`;
  const yvals = Array.from({ length: 5 }, (_, i) => lo + (i / 4) * (hi - lo));
  const years: { i: number; yr: string }[] = [];
  let ly = "";
  h.forEach((p, i) => { const yr = p[0].slice(0, 4); if (yr !== ly) { years.push({ i, yr }); ly = yr; } });
  const sfx = ind.unit === "pp" ? " pp" : ind.unit === "%" ? "%" : "";
  const col = "#60a5fa";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-bold text-[var(--text)]">{ind.label}</h3>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-2xl font-semibold tabular-nums text-[var(--text)]">{ind.value == null ? "—" : ind.value.toFixed(2) + sfx}</span>
              <span className="text-xs text-[var(--text-4)]">latest {ind.asOf || ""} · ~5-year history</span>
            </div>
          </div>
          <button onClick={onClose} aria-label="Close" className="rounded-lg p-1.5 text-[var(--text-3)] hover:bg-[var(--surface-hover)] hover:text-[var(--text)]">✕</button>
        </div>
        {n < 2 ? (
          <div className="py-16 text-center text-sm text-[var(--text-3)]">No history available.</div>
        ) : (
          <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
            {yvals.map((v, i) => (
              <g key={i}>
                <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="var(--surface-hover)" strokeWidth={1} />
                <text x={ML - 6} y={y(v) + 3} textAnchor="end" fontSize={11} fill="var(--text-4)">{v.toFixed(1)}{sfx}</text>
              </g>
            ))}
            {years.map((yr, k) => (
              <text key={k} x={x(yr.i)} y={H - 8} textAnchor={k === 0 ? "start" : "middle"} fontSize={11} fill="var(--text-4)">{yr.yr}</text>
            ))}
            <defs>
              <linearGradient id="indg" x1="0" x2="0" y1="0" y2="1">
                <stop offset="0%" stopColor={col} stopOpacity={0.18} />
                <stop offset="100%" stopColor={col} stopOpacity={0} />
              </linearGradient>
            </defs>
            <path d={area} fill="url(#indg)" />
            <path d={line} fill="none" stroke={col} strokeWidth={1.8} />
          </svg>
        )}
        <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-[var(--text-4)]">
          <span>Data from FRED (St. Louis Fed){ind.seriesId ? ` · ${ind.seriesId}` : ""}.</span>
          {ind.seriesId && <a href={`https://fred.stlouisfed.org/series/${ind.seriesId}`} target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">Full series on FRED ↗</a>}
        </div>
      </div>
    </div>
  );
}

// Recent prints for one economic release — bars for changes/rates, a line for
// levels — plus (for GDP) the Atlanta Fed GDPNow nowcast as a highlighted "est" bar.
function ReleaseDetail({ r }: { r: ReleaseData }) {
  const hist = r.history;
  if (hist.length < 2) return null;
  const dec = r.unit === "K" ? 0 : r.unit === "M" ? 2 : 1;
  const sign = r.chart === "bar";
  const fmt = (v: number | null) => (v == null ? "—" : `${sign && v >= 0 ? "+" : ""}${v.toFixed(dec)}${r.unit}`);
  const lab = (d: string) => {
    const [y, m] = d.split("-").map(Number);
    if (r.key === "gdp") return `Q${Math.floor((m - 1) / 3) + 1}'${String(y).slice(2)}`;
    return new Date(Date.UTC(y, m - 1, 1)).toLocaleDateString("en-US", { month: "short" }) + `'${String(y).slice(2)}`;
  };
  const W = 520, H = 124, ML = 38, MR = 10, MT = 12, MB = 16;
  const axisFmt = (v: number) => `${v.toFixed(dec)}${r.unit}`;

  let chart: React.ReactNode;
  if (r.chart === "bar") {
    const bars: { d: string; v: number; est?: boolean }[] = hist.map(([d, v]) => ({ d, v }));
    if (r.nowcast != null) bars.push({ d: "est", v: r.nowcast, est: true });
    const vals = bars.map((b) => b.v);
    const hi = Math.max(0, ...vals), lo = Math.min(0, ...vals);
    const span = hi - lo || 1;
    const bw = (W - ML - MR) / bars.length;
    const y = (v: number) => MT + ((hi - v) / span) * (H - MT - MB);
    const zeroY = y(0);
    const every = Math.ceil(bars.length / 9);
    const yvals = Array.from({ length: 4 }, (_, k) => lo + (k / 3) * (hi - lo));
    chart = (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
        {yvals.map((v, k) => (
          <g key={"y" + k}>
            <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="var(--surface-hover)" strokeWidth={1} />
            <text x={ML - 4} y={y(v) + 3} textAnchor="end" fontSize={8} fill="var(--text-4)" className="tabular-nums">{axisFmt(v)}</text>
          </g>
        ))}
        <line x1={ML} x2={W - MR} y1={zeroY} y2={zeroY} stroke="var(--border)" strokeWidth={1.2} />
        {bars.map((b, i) => {
          const cx = ML + i * bw + bw / 2;
          const top = Math.min(y(b.v), zeroY);
          const h = Math.max(1, Math.abs(y(b.v) - zeroY));
          const col = b.est ? "#f59e0b" : b.v >= 0 ? "#22c55e" : "#ef4444";
          const last = i === bars.length - 1;
          return (
            <g key={i}>
              <rect x={cx - bw * 0.32} y={top} width={bw * 0.64} height={h} rx={1.5} fill={col} fillOpacity={b.est ? 0.5 : 0.85} stroke={b.est ? col : "none"} strokeWidth={b.est ? 1 : 0} strokeDasharray={b.est ? "3 2" : undefined} />
              {(last || b.est) && <text x={cx} y={b.v >= 0 ? top - 3 : top + h + 9} textAnchor="middle" fontSize={9} fill="var(--text-3)" className="tabular-nums">{b.v >= 0 ? "+" : ""}{b.v.toFixed(dec)}</text>}
              {(last || b.est || i % every === 0) && <text x={cx} y={H - 4} textAnchor="middle" fontSize={8} fill="var(--text-4)">{b.est ? "est" : lab(b.d)}</text>}
            </g>
          );
        })}
      </svg>
    );
  } else {
    const n = hist.length;
    const vals = hist.map((h) => h[1]);
    let hi = Math.max(...vals), lo = Math.min(...vals);
    const pad = (hi - lo) * 0.12 || 1; hi += pad; lo -= pad;
    const x = (i: number) => ML + (i / Math.max(1, n - 1)) * (W - ML - MR);
    const y = (v: number) => MT + ((hi - v) / (hi - lo || 1)) * (H - MT - MB);
    const line = hist.map((h, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(h[1]).toFixed(1)}`).join("");
    const area = `${line}L${x(n - 1).toFixed(1)} ${(H - MB).toFixed(1)}L${x(0).toFixed(1)} ${(H - MB).toFixed(1)}Z`;
    const yvals = Array.from({ length: 4 }, (_, k) => lo + (k / 3) * (hi - lo));
    chart = (
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
        {yvals.map((v, k) => (
          <g key={"y" + k}>
            <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="var(--surface-hover)" strokeWidth={1} />
            <text x={ML - 4} y={y(v) + 3} textAnchor="end" fontSize={8} fill="var(--text-4)" className="tabular-nums">{axisFmt(v)}</text>
          </g>
        ))}
        <defs><linearGradient id={`rg-${r.key}`} x1="0" x2="0" y1="0" y2="1"><stop offset="0%" stopColor="#60a5fa" stopOpacity={0.16} /><stop offset="100%" stopColor="#60a5fa" stopOpacity={0} /></linearGradient></defs>
        <path d={area} fill={`url(#rg-${r.key})`} />
        <path d={line} fill="none" stroke="#60a5fa" strokeWidth={1.8} />
        <circle cx={x(n - 1)} cy={y(hist[n - 1][1])} r={2.5} fill="#60a5fa" />
        <text x={ML} y={H - 4} fontSize={8} fill="var(--text-4)">{lab(hist[0][0])}</text>
        <text x={W - MR} y={H - 4} textAnchor="end" fontSize={8} fill="var(--text-4)">{lab(hist[n - 1][0])}</text>
      </svg>
    );
  }

  return (
    <div className="pb-1">
      <div className="mb-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 text-[11px]">
        <span className="text-[var(--text-4)]">{r.hint}</span>
        <span className="text-[var(--text-3)]">Latest <span className="font-mono font-semibold tabular-nums text-[var(--text)]">{fmt(r.latest)}</span>{r.latestDate ? ` · ${r.latestDate}` : ""}</span>
        <span className="text-[var(--text-3)]">Prior <span className="font-mono tabular-nums">{fmt(r.prior)}</span></span>
        {r.nowcast != null && <span className="font-semibold text-[#f59e0b]">GDPNow est <span className="font-mono tabular-nums">{fmt(r.nowcast)}</span></span>}
      </div>
      {chart}
    </div>
  );
}

// Consensus economist estimate for an upcoming release (ForexFactory).
function ConsensusLine({ est }: { est: EconEstimate }) {
  return (
    <div className="mb-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5 rounded-lg border border-[#60a5fa]/30 bg-[#60a5fa]/[0.06] px-2.5 py-1.5 text-[11px]">
      <span className="font-semibold text-[var(--accent)]">Consensus {est.forecast}</span>
      <span className="text-[var(--text-3)]">vs prior {est.previous || "—"}</span>
      <span className="text-[var(--text-4)]">· {est.title} · via ForexFactory</span>
    </div>
  );
}

export default function MacroDashboard({
  curve,
  indicators,
  asOf,
  calendar,
  keyConfigured,
  volOil,
  releases,
  creditSeries,
}: {
  curve: CurvePoint[];
  indicators: MacroInd[];
  asOf: string;
  calendar: EconEvent[];
  keyConfigured: boolean;
  volOil?: VolOil;
  releases?: Record<string, ReleaseData>;
  creditSeries?: CreditSeries;
}) {
  const router = useRouter();
  const universe = (usePathname() || "").match(/^\/u\/([^/]+)/)?.[1] || "sp500";
  const [refreshing, setRefreshing] = useState(false);
  const [detail, setDetail] = useState<MacroInd | null>(null);
  const [openRows, setOpenRows] = useState<Set<number>>(new Set());
  const toggleRow = (i: number) =>
    setOpenRows((s) => {
      const n = new Set(s);
      n.has(i) ? n.delete(i) : n.add(i);
      return n;
    });
  // "Credit" renders as the richer windowed CreditSpreads charts below, not plain cards.
  const groups = [...new Set(indicators.map((i) => i.group))].filter((g) => g !== "Credit");
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Economy</h1>
          <p className="mt-1 text-xs text-[var(--text-3)]">
            U.S. macro — rates, inflation, growth &amp; credit · data from FRED (St. Louis Fed) · as of {fmtDateTime(asOf)}
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
        <div className="mt-2 text-right">
          <Link href={`/u/${universe}/rates`} className="text-xs font-medium text-[var(--accent)] hover:underline">Rates &amp; credit detail — curve spreads, inversion &amp; OAS trends →</Link>
        </div>
      </section>

      {volOil && (volOil.vix.length > 1 || volOil.oil.length > 1) && (
        <div className="mb-6 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {volOil.vix.length > 1 && (
            <CurveChart id="vix" points={volOil.vix} color="#a855f7" unit="" title="VIX term structure" subtitle="CBOE S&P 500 implied volatility, 9-day → 1-year · live" />
          )}
          {volOil.oil.length > 1 && (
            <CurveChart id="oil" points={volOil.oil} color="#f59e0b" unit="" title="WTI crude futures curve" subtitle="Front-month → ~10 months out (NYMEX, $/bbl) · live" />
          )}
        </div>
      )}

      {groups.map((g) => (
        <section key={g} className="mb-5">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-[var(--text-3)]">{g}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {indicators.filter((i) => i.group === g).map((i) => <IndCard key={i.key} ind={i} onOpen={() => setDetail(i)} />)}
          </div>
        </section>
      ))}

      <div className="mb-5"><CreditSpreads creditSeries={creditSeries} /></div>

      <section className="mb-5">
        <h2 className="mb-2 text-sm font-semibold text-[var(--text-2)]">Upcoming US economic releases</h2>
        {calendar.length === 0 ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-xs text-[var(--text-3)]">No upcoming releases found.</div>
        ) : (
          <>
            <p className="mb-1.5 text-[11px] text-[var(--text-4)]">Click a release to see its recent prints. <span className="text-[var(--accent)]">cons</span> = consensus estimate (this week, via ForexFactory){releases?.gdp?.nowcast != null ? "; GDP also shows the Atlanta Fed nowcast" : ""}.</p>
            <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
              {calendar.map((e, i) => {
                const rel = releases?.[LABEL_TO_RELEASE[e.label] ?? ""];
                const open = openRows.has(i);
                const dec = rel ? (rel.unit === "K" ? 0 : rel.unit === "M" ? 2 : 1) : 1;
                const latestStr = rel && rel.latest != null ? `${rel.chart === "bar" && rel.latest >= 0 ? "+" : ""}${rel.latest.toFixed(dec)}${rel.unit}` : null;
                return (
                  <div key={i} className="border-b border-[var(--divider)] last:border-0">
                    <button
                      onClick={() => rel && toggleRow(i)}
                      disabled={!rel}
                      className={"flex w-full items-center justify-between gap-2 px-4 py-2 text-left text-sm transition-colors " + (rel ? "hover:bg-[var(--surface-hover)]" : "cursor-default")}
                    >
                      <span className="flex min-w-0 items-center gap-1.5 text-[var(--text)]">
                        <span className="w-2.5 shrink-0 text-[10px] text-[var(--text-4)]">{rel ? (open ? "▾" : "▸") : ""}</span>
                        <span className="truncate">{e.label}</span>
                        {e.approx && <span className="shrink-0 text-[11px] text-[var(--text-4)]" title="Approximate — typical release date">≈</span>}
                        {rel?.nowcast != null && <span className="shrink-0 rounded bg-[#f59e0b]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[#f59e0b]" title="Atlanta Fed GDPNow nowcast">nowcast {rel.nowcast >= 0 ? "+" : ""}{rel.nowcast.toFixed(1)}%</span>}
                        {e.estimate && <span className="shrink-0 rounded bg-[#60a5fa]/15 px-1.5 py-0.5 text-[10px] font-semibold text-[var(--accent)]" title={`Consensus for "${e.estimate.title}" — via ForexFactory`}>cons {e.estimate.forecast}</span>}
                      </span>
                      <span className="flex shrink-0 items-center gap-3 tabular-nums">
                        {latestStr && <span className="hidden font-mono text-xs text-[var(--text-3)] sm:inline" title="Most recent print">{latestStr}</span>}
                        <span className="text-[var(--text-3)]">{new Date(e.date + "T12:00:00Z").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })}</span>
                      </span>
                    </button>
                    {open && rel && (
                      <div className="px-4">
                        {e.estimate && <ConsensusLine est={e.estimate} />}
                        <ReleaseDetail r={rel} />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
            {!keyConfigured && (
              <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--text-4)]">
                Jobless claims &amp; the jobs report are exact; <span className="text-[var(--text-3)]">≈</span> marks dates estimated from each release&apos;s typical schedule. Add a free{" "}
                <a href="https://fredaccount.stlouisfed.org/apikeys" target="_blank" rel="noreferrer" className="text-[var(--accent)] hover:underline">FRED_API_KEY</a> for exact release dates.
              </p>
            )}
          </>
        )}
      </section>

      <p className="mt-2 text-[11px] text-[var(--text-4)]">
        Source: Federal Reserve Economic Data (FRED). Spreads in percentage points; OAS = option-adjusted spread.
      </p>

      {detail && <IndicatorDetail ind={detail} onClose={() => setDetail(null)} />}
    </main>
  );
}
