"use client";
import { useEffect, useState, type ReactNode } from "react";
import { type IndexTrendData, type IndexTrend, type TrendPoint, VERDICT_COLOR, fmtIdx, signPct } from "@/lib/indexTrend";

const yearOf = (ms: number) => new Date(ms).getUTCFullYear();
const DAY = 86_400_000;

// 1-2-5 decade ticks within [min,max] for a log price axis.
function logTicks(min: number, max: number): number[] {
  const out: number[] = [];
  const lo = Math.floor(Math.log10(min)), hi = Math.ceil(Math.log10(max));
  for (let e = lo; e <= hi; e++) for (const m of [1, 2, 5]) { const v = m * Math.pow(10, e); if (v >= min * 0.85 && v <= max * 1.15) out.push(v); }
  return out.length ? out : [min, max];
}

// Small card channel chart (no Y axis) — the log-linear trend is a straight line; ±1σ/±2σ bands parallel.
function ChannelChart({ t }: { t: IndexTrend }) {
  const h = t.history;
  if (h.length < 2) return null;
  const W = 560, H = 180, padL = 6, padR = 6, padT = 8, padB = 18;
  const t0 = h[0][0], t1 = h[h.length - 1][0];
  let lnLo = Infinity, lnHi = -Infinity;
  for (const p of h) { lnLo = Math.min(lnLo, Math.log(p[5]), Math.log(p[1])); lnHi = Math.max(lnHi, Math.log(p[6]), Math.log(p[1])); }
  const pad = (lnHi - lnLo) * 0.04; lnLo -= pad; lnHi += pad;
  const x = (ms: number) => padL + ((ms - t0) / (t1 - t0 || 1)) * (W - padL - padR);
  const y = (v: number) => padT + (1 - (Math.log(v) - lnLo) / (lnHi - lnLo || 1)) * (H - padT - padB);
  const line = (idx: number) => h.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[idx]).toFixed(1)}`).join(" ");
  const band = (hiIdx: number, loIdx: number) =>
    h.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[hiIdx]).toFixed(1)}`).join(" ") +
    " " + [...h].reverse().map((p) => `L${x(p[0]).toFixed(1)},${y(p[loIdx]).toFixed(1)}`).join(" ") + " Z";
  const vc = VERDICT_COLOR[t.verdict];
  const ticks: number[] = [];
  const span = t1 - t0, nt = 4;
  for (let i = 0; i <= nt; i++) ticks.push(t0 + (span * i) / nt);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" className="block" style={{ height: "180px" }}>
      <path d={band(6, 5)} fill="var(--text-4)" opacity={0.08} />
      <path d={band(4, 3)} fill="var(--text-4)" opacity={0.1} />
      <path d={line(2)} fill="none" stroke="var(--text-4)" strokeWidth={1} strokeDasharray="4 3" opacity={0.8} />
      <path d={line(1)} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinejoin="round" />
      <circle cx={x(h[h.length - 1][0])} cy={y(h[h.length - 1][1])} r={3.2} fill={vc} stroke="var(--surface)" strokeWidth={1} />
      {ticks.map((tk, i) => (
        <text key={i} x={Math.min(W - 14, Math.max(10, x(tk)))} y={H - 5} fontSize={9} textAnchor="middle" fill="var(--text-4)">{yearOf(tk)}</text>
      ))}
    </svg>
  );
}

// Large channel chart for the detail modal: adds a log-scale Y axis (price ticks) + X-axis year ticks.
function ChannelChartLarge({ points }: { points: TrendPoint[] }) {
  if (points.length < 2) return <div className="flex h-[300px] items-center justify-center text-[12px] text-[var(--text-4)]">Not enough history for this window.</div>;
  const W = 720, H = 300, mL = 54, mR = 12, mT = 10, mB = 24;
  const t0 = points[0][0], t1 = points[points.length - 1][0];
  let vMin = Infinity, vMax = -Infinity;
  for (const p of points) { vMin = Math.min(vMin, p[5], p[1]); vMax = Math.max(vMax, p[6], p[1]); }
  const padLn = (Math.log(vMax) - Math.log(vMin)) * 0.04;
  const yLo = Math.log(vMin) - padLn, yHi = Math.log(vMax) + padLn;
  const x = (ms: number) => mL + ((ms - t0) / (t1 - t0 || 1)) * (W - mL - mR);
  const y = (v: number) => mT + (1 - (Math.log(v) - yLo) / (yHi - yLo || 1)) * (H - mT - mB);
  const line = (idx: number) => points.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[idx]).toFixed(1)}`).join(" ");
  const band = (hiIdx: number, loIdx: number) =>
    points.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[hiIdx]).toFixed(1)}`).join(" ") +
    " " + [...points].reverse().map((p) => `L${x(p[0]).toFixed(1)},${y(p[loIdx]).toFixed(1)}`).join(" ") + " Z";
  const yticks = logTicks(vMin, vMax);
  const xticks: number[] = []; const n = 5;
  for (let i = 0; i <= n; i++) xticks.push(t0 + ((t1 - t0) * i) / n);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ height: "300px" }}>
      {yticks.map((v, i) => (
        <g key={i}>
          <line x1={mL} x2={W - mR} y1={y(v)} y2={y(v)} stroke="var(--divider)" strokeWidth={1} />
          <text x={mL - 6} y={y(v) + 3} fontSize={10} textAnchor="end" fill="var(--text-4)">{fmtIdx(v)}</text>
        </g>
      ))}
      <path d={band(6, 5)} fill="var(--text-4)" opacity={0.08} />
      <path d={band(4, 3)} fill="var(--text-4)" opacity={0.1} />
      <path d={line(2)} fill="none" stroke="var(--text-4)" strokeWidth={1} strokeDasharray="4 3" opacity={0.8} />
      <path d={line(1)} fill="none" stroke="var(--accent)" strokeWidth={1.8} strokeLinejoin="round" />
      <circle cx={x(t1)} cy={y(points[points.length - 1][1])} r={3.2} fill="var(--accent)" />
      {xticks.map((tk, i) => (
        <text key={i} x={x(tk)} y={H - 8} fontSize={10} textAnchor={i === 0 ? "start" : i === n ? "end" : "middle"} fill="var(--text-4)">{yearOf(tk)}</text>
      ))}
    </svg>
  );
}

function ZGauge({ z, verdict }: { z: number; verdict: IndexTrend["verdict"] }) {
  const clamped = Math.max(-2.4, Math.min(2.4, z));
  const pct = ((clamped + 2.4) / 4.8) * 100;
  return (
    <div className="mt-1">
      <div className="relative h-1.5 rounded-full" style={{ background: "linear-gradient(90deg,#16a34a,#22c55e,var(--surface-2),#f59e0b,#ef4444)" }}>
        <div className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--surface)]" style={{ left: `${pct}%`, background: VERDICT_COLOR[verdict] }} />
      </div>
      <div className="mt-0.5 flex justify-between text-[9px] text-[var(--text-4)]"><span>−2σ cheap</span><span>trend</span><span>+2σ dear</span></div>
    </div>
  );
}

const CH_TF = [{ label: "5Y", days: 1827 }, { label: "10Y", days: 3653 }, { label: "20Y", days: 7305 }];

function ChannelDetailModal({ t, onClose }: { t: IndexTrend; onClose: () => void }) {
  const h = t.history;
  const spanDays = h.length >= 2 ? (h[h.length - 1][0] - h[0][0]) / DAY : 0;
  const opts = CH_TF.filter((o) => o.days < spanDays); opts.push({ label: "Max", days: Infinity });
  const [tf, setTf] = useState<string>("Max");
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const days = opts.find((o) => o.label === tf)?.days ?? Infinity;
  const cutoff = Date.now() - days * DAY;
  const win = days === Infinity ? h : h.filter((p) => p[0] >= cutoff);
  const pts = win.length >= 2 ? win : h;
  const vc = VERDICT_COLOR[t.verdict];
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold text-[var(--text)]">{t.label}</span>
              <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: `${vc}22`, color: vc }}>{t.verdict}</span>
            </div>
            <div className="mt-0.5 text-[12px] text-[var(--text-3)]"><b className="font-mono tabular-nums text-[var(--text)]">{fmtIdx(t.current)}</b><span className="text-[var(--text-4)]"> vs trend {fmtIdx(t.trendNow)} · </span><b className="tabular-nums" style={{ color: vc }}>{signPct(t.pctFromTrend)}</b></div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg px-2 py-1 text-[var(--text-4)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]" aria-label="Close">✕</button>
        </div>
        <div className="mb-2 inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          {opts.map((o) => (
            <button key={o.label} onClick={() => setTf(o.label)} className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (tf === o.label ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{o.label}</button>
          ))}
        </div>
        <ChannelChartLarge points={pts} />
        <ZGauge z={t.z} verdict={t.verdict} />
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[var(--text-4)]">
          <span><b className="text-[var(--text-3)]">{t.z >= 0 ? "+" : ""}{t.z.toFixed(2)}σ</b> from trend</span>
          <span><b className="text-[var(--text-3)]">{t.cagrPct.toFixed(1)}%</b> trend CAGR</span>
          <span><b className="text-[var(--text-3)]">±{t.sigma1Pct.toFixed(0)}%</b> 1σ band</span>
          <span>fit since <b className="text-[var(--text-3)]">{t.startYear}</b> ({t.nMonths} mo)</span>
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-[var(--text-4)]">The read (z-score, verdict) is vs the full-history fit; the timeframe just zooms the view. {t.source}. Log price scale; descriptive, not predictive.</p>
      </div>
    </div>
  );
}

function IndexCard({ t, onOpen }: { t: IndexTrend; onOpen: () => void }) {
  const vc = VERDICT_COLOR[t.verdict];
  return (
    <div onClick={onOpen} title="Click for the full channel + timeframes" className="cursor-pointer rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5 transition-colors hover:border-[var(--accent)]">
      <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <h4 className="text-[15px] font-semibold text-[var(--text)]">{t.label}</h4>
          <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: `${vc}22`, color: vc }}>{t.verdict}</span>
        </div>
        <div className="text-[12px] text-[var(--text-3)]">
          <b className="font-mono tabular-nums text-[var(--text)]">{fmtIdx(t.current)}</b>
          <span className="text-[var(--text-4)]"> vs trend {fmtIdx(t.trendNow)} · </span>
          <b className="tabular-nums" style={{ color: vc }}>{signPct(t.pctFromTrend)}</b>
        </div>
      </div>
      <ChannelChart t={t} />
      <ZGauge z={t.z} verdict={t.verdict} />
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-[var(--text-4)]">
        <span title="Standard deviations above/below the fitted trend (log space)"><b className="text-[var(--text-3)]">{t.z >= 0 ? "+" : ""}{t.z.toFixed(2)}σ</b> from trend</span>
        <span title="Fitted annual trend growth (price only, ex-dividends)"><b className="text-[var(--text-3)]">{t.cagrPct.toFixed(1)}%</b> trend CAGR</span>
        <span><b className="text-[var(--text-3)]">±{t.sigma1Pct.toFixed(0)}%</b> 1σ band</span>
        <span>fit since <b className="text-[var(--text-3)]">{t.startYear}</b> ({t.nMonths} mo)</span>
      </div>
    </div>
  );
}

export default function IndexTrendPanel({
  data,
  title = "Index valuation",
  subtitle = "price vs its long-run trend channel",
  footer,
}: {
  data: IndexTrendData | null;
  title?: string;
  subtitle?: string;
  footer?: ReactNode;
}) {
  const [detail, setDetail] = useState<IndexTrend | null>(null);
  const header = (
    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
      <h3 className="text-base font-semibold text-[var(--text)]">{title} <span className="text-[13px] font-normal text-[var(--text-4)]">· {subtitle}</span></h3>
    </div>
  );
  // Graceful pending state — the feed populates on the nightly FULL; never show a scary blank.
  if (!data || !data.indices.length) {
    return (
      <section className="mt-4">
        {header}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4 text-[13px] text-[var(--text-3)]">
          Building the trend channels — this populates on the next nightly refresh. Check back shortly.
        </div>
      </section>
    );
  }
  const asOf = (() => { const d = Date.parse(data.asOf); return Number.isNaN(d) ? "" : new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); })();
  return (
    <section className="mt-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--text)]">{title} <span className="text-[13px] font-normal text-[var(--text-4)]">· {subtitle}</span></h3>
        {asOf && <span className="text-[11px] text-[var(--text-4)]">as of {asOf}</span>}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {data.indices.map((t) => <IndexCard key={t.key} t={t} onOpen={() => setDetail(t)} />)}
      </div>
      {footer ?? (
        <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-4)]">
          Click any card for the full channel with selectable timeframes. A log-linear regression of price on time with ±1σ/±2σ (~68% / ~95%) bands — where price sits gauges how cheap/dear the market is vs its own long-term exponential growth. S&amp;P fit from 1932 (Shiller/datahub); Nasdaq &amp; Russell from their modern history (Yahoo). <span className="text-[#f59e0b]">Descriptive, not predictive</span> — reversion isn&apos;t guaranteed and the fit is sensitive to the start year. Price-only (ex-dividends). Decision-support, not advice.
        </p>
      )}
      {detail && <ChannelDetailModal t={detail} onClose={() => setDetail(null)} />}
    </section>
  );
}
