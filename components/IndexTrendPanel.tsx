"use client";
import { type IndexTrendData, type IndexTrend, VERDICT_COLOR, fmtIdx, signPct } from "@/lib/indexTrend";

const yearOf = (ms: number) => new Date(ms).getUTCFullYear();

// Log-scale channel: the log-linear trend is a straight line, so the ±1σ/±2σ bands are parallel. Price
// weaves through; where it ends vs the channel = the cheap/dear read.
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
  // filled band between two series indices (hi index forward, lo index back)
  const band = (hiIdx: number, loIdx: number) =>
    h.map((p, i) => `${i ? "L" : "M"}${x(p[0]).toFixed(1)},${y(p[hiIdx]).toFixed(1)}`).join(" ") +
    " " + [...h].reverse().map((p) => `L${x(p[0]).toFixed(1)},${y(p[loIdx]).toFixed(1)}`).join(" ") + " Z";
  const vc = VERDICT_COLOR[t.verdict];
  // ~4 year ticks
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

// Position of z within the ±2σ channel, as a marker on a cheap→dear rail.
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

function IndexCard({ t }: { t: IndexTrend }) {
  const vc = VERDICT_COLOR[t.verdict];
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3.5">
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

export default function IndexTrendPanel({ data }: { data: IndexTrendData | null }) {
  if (!data || !data.indices.length) return null;
  const asOf = (() => { const d = Date.parse(data.asOf); return Number.isNaN(d) ? "" : new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" }); })();
  return (
    <section className="mt-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--text)]">Index valuation <span className="text-[13px] font-normal text-[var(--text-4)]">· price vs its long-run trend channel</span></h3>
        {asOf && <span className="text-[11px] text-[var(--text-4)]">as of {asOf}</span>}
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        {data.indices.map((t) => <IndexCard key={t.key} t={t} />)}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-4)]">
        A log-linear regression of price on time with ±1σ/±2σ (~68% / ~95%) bands — where price sits in the channel gauges how cheap/dear the market is vs its own long-term exponential growth. S&amp;P fit from 1932 (Shiller/datahub); Nasdaq &amp; Russell from their modern history (Yahoo). <span className="text-[#f59e0b]">Descriptive, not predictive</span> — reversion to a fitted trend isn&apos;t guaranteed and the fit is sensitive to the start year. Price-only (ex-dividends). Decision-support, not advice.
      </p>
    </section>
  );
}
