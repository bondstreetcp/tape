"use client";
import { useEffect, useState } from "react";
import { type RealEconomyData, type RealEcoSeries, type TsaThroughput, GROUP_ORDER, REGIME_COLOR, SERIES_TOOLTIPS, fmtVal, fmtPct, fmtChange, pctColor } from "@/lib/realEconomy";

// change colour, inverted for lower-is-better series (falling jobless claims / mortgage rates = green).
const cc = (v: number | null, invert?: boolean) => pctColor(v == null ? null : invert ? -v : v);

// ── a normalized item for the detail modal (from a FRED series or the TSA feed) ──
type DetailItem = {
  label: string;
  unit: string;
  changeUnit?: "%" | "pts";
  history: [string, number][];
  current: number | null;
  latestDate: string | null;
  source: string;
  note?: string;
  tooltip?: string;
  lines: { label: string; value: string; color?: string }[];
};
const seriesDetail = (s: RealEcoSeries): DetailItem => ({
  label: s.label, unit: s.unit, changeUnit: s.changeUnit, history: s.history, current: s.latest, latestDate: s.latestDate, source: s.source, note: s.note, tooltip: SERIES_TOOLTIPS[s.key],
  lines: [
    { label: "YoY", value: fmtChange(s.yoyPct, s.changeUnit), color: pctColor(s.yoyPct) },
    ...(s.momPct != null ? [{ label: "MoM", value: fmtChange(s.momPct, s.changeUnit), color: pctColor(s.momPct) }] : []),
  ],
});
const tsaDetail = (t: TsaThroughput): DetailItem => ({
  label: "Air travel · TSA throughput", unit: "pax/day", history: t.history, current: t.latest, latestDate: t.latestDate, source: t.source, note: "daily demand proxy (not load factor)", tooltip: SERIES_TOOLTIPS.tsa,
  lines: [
    { label: "7-day avg", value: fmtVal(t.avg7, "") },
    { label: "vs 1mo", value: fmtPct(t.chg30dPct), color: pctColor(t.chg30dPct) },
  ],
});

// "Nice" round tick values spanning [min,max] for a readable Y axis.
function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) return [min];
  const step0 = (max - min) / count, mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const norm = step0 / mag, step = (norm >= 5 ? 5 : norm >= 2 ? 2 : 1) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(v);
  return out;
}

const DAY = 86_400_000;

// Tiny inline sparkline for the card (recent window).
function Spark({ points }: { points: [string, number][] }) {
  if (!points || points.length < 2) return null;
  const vals = points.map((p) => p[1]);
  const min = Math.min(...vals), max = Math.max(...vals);
  const W = 104, H = 26, pad = 2;
  const x = (i: number) => pad + (i / (points.length - 1)) * (W - 2 * pad);
  const y = (v: number) => (max === min ? H / 2 : pad + (1 - (v - min) / (max - min)) * (H - 2 * pad));
  const d = points.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} className="shrink-0">
      <path d={d} fill="none" stroke={up ? "#22c55e" : "#ef4444"} strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" opacity={0.85} />
    </svg>
  );
}

// Full chart with X + Y axes for the detail modal (history already windowed to the timeframe).
function DetailChart({ points, unit }: { points: [string, number][]; unit: string }) {
  if (points.length < 2) return <div className="flex h-[260px] items-center justify-center text-[12px] text-[var(--text-4)]">Not enough history for this window.</div>;
  const W = 720, H = 260, mL = 52, mR = 12, mT = 10, mB = 26;
  const ts = points.map((p) => Date.parse(p[0]));
  const vals = points.map((p) => p[1]);
  const t0 = ts[0], t1 = ts[ts.length - 1];
  const vMin = Math.min(...vals), vMax = Math.max(...vals);
  const yticks = niceTicks(vMin, vMax, 4);
  const lo = Math.min(vMin, yticks[0]), hi = Math.max(vMax, yticks[yticks.length - 1]);
  const x = (t: number) => mL + ((t - t0) / (t1 - t0 || 1)) * (W - mL - mR);
  const y = (v: number) => mT + (1 - (v - lo) / (hi - lo || 1)) * (H - mT - mB);
  const line = points.map((p, i) => `${i ? "L" : "M"}${x(ts[i]).toFixed(1)},${y(p[1]).toFixed(1)}`).join(" ");
  const spanDays = (t1 - t0) / DAY;
  const fmtDate = (t: number) => {
    const d = new Date(t);
    if (spanDays > 1100) return String(d.getUTCFullYear());
    if (spanDays > 170) return d.toLocaleDateString("en-US", { month: "short", year: "2-digit" });
    return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  };
  const xticks: number[] = [];
  const n = 5;
  for (let i = 0; i <= n; i++) xticks.push(t0 + ((t1 - t0) * i) / n);
  const up = vals[vals.length - 1] >= vals[0];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" preserveAspectRatio="none" style={{ height: "260px" }}>
      {yticks.map((v, i) => (
        <g key={i}>
          <line x1={mL} x2={W - mR} y1={y(v)} y2={y(v)} stroke="var(--divider)" strokeWidth={1} />
          <text x={mL - 6} y={y(v) + 3} fontSize={10} textAnchor="end" fill="var(--text-4)">{fmtVal(v, unit)}</text>
        </g>
      ))}
      {xticks.map((t, i) => (
        <text key={i} x={x(t)} y={H - 8} fontSize={10} textAnchor={i === 0 ? "start" : i === n ? "end" : "middle"} fill="var(--text-4)">{fmtDate(t)}</text>
      ))}
      <path d={line} fill="none" stroke={up ? "#22c55e" : "#ef4444"} strokeWidth={1.8} strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={x(t1)} cy={y(vals[vals.length - 1])} r={3.2} fill={up ? "#22c55e" : "#ef4444"} />
    </svg>
  );
}

const TF_OPTS = [
  { label: "1Y", days: 366 }, { label: "3Y", days: 1096 }, { label: "5Y", days: 1827 }, { label: "10Y", days: 3653 },
  { label: "6M", days: 184 }, { label: "3M", days: 92 },
];

function DetailModal({ item, onClose }: { item: DetailItem; onClose: () => void }) {
  const hist = item.history || [];
  const spanDays = hist.length >= 2 ? (Date.parse(hist[hist.length - 1][0]) - Date.parse(hist[0][0])) / DAY : 0;
  // timeframe options that fit the data (+ Max), largest→smallest, then default to ~5Y (or Max if shorter).
  const opts = [...TF_OPTS].filter((o) => o.days < spanDays).sort((a, b) => a.days - b.days);
  opts.push({ label: "Max", days: Infinity });
  const [tf, setTf] = useState<string>(() => (opts.find((o) => o.label === "5Y") ? "5Y" : opts.find((o) => o.label === "3Y") ? "3Y" : "Max"));
  useEffect(() => {
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [onClose]);
  const days = opts.find((o) => o.label === tf)?.days ?? Infinity;
  const cutoff = Date.now() - days * DAY;
  const windowed = days === Infinity ? hist : hist.filter((p) => Date.parse(p[0]) >= cutoff);
  const pts = windowed.length >= 2 ? windowed : hist.slice(-2);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <div className="text-base font-semibold text-[var(--text)]">{item.label}</div>
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 text-[12px] text-[var(--text-3)]">
              <span className="font-mono text-lg font-bold tabular-nums text-[var(--text)]">{fmtVal(item.current, item.unit)}</span>
              <span className="text-[var(--text-4)]">{item.unit}{item.latestDate ? ` · ${item.latestDate}` : ""}</span>
              {item.lines.map((l, i) => <span key={i}><b className="text-[var(--text-4)]">{l.label}</b> <span className="tabular-nums font-medium" style={{ color: l.color }}>{l.value}</span></span>)}
            </div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg px-2 py-1 text-[var(--text-4)] hover:bg-[var(--surface-2)] hover:text-[var(--text)]" aria-label="Close">✕</button>
        </div>
        <div className="mb-2 inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface-2)] p-0.5">
          {opts.map((o) => (
            <button key={o.label} onClick={() => setTf(o.label)} className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (tf === o.label ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{o.label}</button>
          ))}
        </div>
        <DetailChart points={pts} unit={item.unit} />
        {item.tooltip && <p className="mt-2 text-[11.5px] leading-snug text-[var(--text-3)]">{item.tooltip}</p>}
        <div className="mt-1.5 text-[11px] leading-snug text-[var(--text-4)]">{item.source}{item.note ? <span className="text-[#f59e0b]"> · {item.note}</span> : null}</div>
      </div>
    </div>
  );
}

const asOfLabel = (iso: string | null) => {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-US", { month: "short", year: "numeric" });
};

function Card({ onOpen, children }: { onOpen: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onOpen} title="Click for the full history + timeframes" className="group w-full rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3 text-left transition-colors hover:border-[var(--accent)]">
      {children}
    </button>
  );
}

function SeriesCard({ s, onOpen }: { s: RealEcoSeries; onOpen: () => void }) {
  return (
    <Card onOpen={onOpen}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="truncate text-[12px] font-medium text-[var(--text-2)]" title={s.label}>{s.label}</span>
            {SERIES_TOOLTIPS[s.key] && <span className="shrink-0 cursor-help text-[10px] text-[var(--text-4)]" title={SERIES_TOOLTIPS[s.key]}>ⓘ</span>}
          </div>
          <div className="mt-0.5 font-mono text-xl font-bold leading-none tabular-nums" style={{ color: s.signLevel ? pctColor(s.latest) : "var(--text)" }} title={s.signLevel ? "Index level: >0 = expansion / above-trend, <0 = contraction / below-trend" : undefined}>{fmtVal(s.latest, s.unit)}</div>
          <div className="mt-0.5 text-[10px] text-[var(--text-4)]">{s.unit}{s.latestDate ? ` · ${asOfLabel(s.latestDate)}` : ""}</div>
        </div>
        <Spark points={s.history.slice(s.freq === "W" ? -104 : -60)} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
        <span title="Year-over-year change"><b className="text-[var(--text-4)]">YoY</b> <span className="font-semibold tabular-nums" style={{ color: cc(s.yoyPct, s.invert) }}>{fmtChange(s.yoyPct, s.changeUnit)}</span></span>
        {s.momPct != null && <span title={s.freq === "W" ? "Week-over-week change" : "Month-over-month change"}><b className="text-[var(--text-4)]">{s.freq === "W" ? "WoW" : "MoM"}</b> <span className="tabular-nums" style={{ color: cc(s.momPct, s.invert) }}>{fmtChange(s.momPct, s.changeUnit)}</span></span>}
      </div>
      <div className="mt-1.5 text-[10px] leading-snug text-[var(--text-4)]">
        {s.source}{s.note ? <span className="text-[#f59e0b]" title={s.note}> · {s.note}</span> : null}
      </div>
    </Card>
  );
}

function TsaCard({ tsa, onOpen }: { tsa: TsaThroughput; onOpen: () => void }) {
  return (
    <Card onOpen={onOpen}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            <span className="truncate text-[12px] font-medium text-[var(--text-2)]">Air travel · TSA throughput</span>
            <span className="shrink-0 cursor-help text-[10px] text-[var(--text-4)]" title={SERIES_TOOLTIPS.tsa}>ⓘ</span>
          </div>
          <div className="mt-0.5 font-mono text-xl font-bold leading-none tabular-nums text-[var(--text)]">{fmtVal(tsa.avg7, "")}</div>
          <div className="mt-0.5 text-[10px] text-[var(--text-4)]">7-day avg pax/day{tsa.latestDate ? ` · thru ${new Date(tsa.latestDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</div>
        </div>
        <Spark points={tsa.history.slice(-60)} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
        <span title="7-day average vs ~1 month earlier (the TSA page is year-to-date only, so no true YoY)"><b className="text-[var(--text-4)]">vs 1mo</b> <span className="font-semibold tabular-nums" style={{ color: pctColor(tsa.chg30dPct) }}>{fmtPct(tsa.chg30dPct)}</span></span>
        {tsa.latest != null && <span className="text-[var(--text-4)]">latest day {fmtVal(tsa.latest, "")}</span>}
      </div>
      <div className="mt-1.5 text-[10px] leading-snug text-[var(--text-4)]">{tsa.source} · daily demand proxy (not load factor)</div>
    </Card>
  );
}

export default function RealEconomyPanel({ data }: { data: RealEconomyData | null }) {
  const [detail, setDetail] = useState<DetailItem | null>(null);
  if (!data || (!data.series.length && !data.tsa)) return null;
  const asOf = asOfLabel(data.asOf);
  return (
    <section className="mt-4">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-base font-semibold text-[var(--text)]">Real economy <span className="text-[13px] font-normal text-[var(--text-4)]">· free freight, travel &amp; housing leads</span></h3>
        {asOf && <span className="text-[11px] text-[var(--text-4)]">refreshed {asOf}</span>}
      </div>
      {data.read && (
        <div className="mb-3 rounded-xl border p-3.5" style={{ background: "var(--accent-soft)", borderColor: "color-mix(in oklab, var(--accent) 30%, transparent)" }}>
          <div className="mb-1.5 flex items-center gap-2">
            <span className="text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Desk read</span>
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: `${REGIME_COLOR[data.read.regime]}22`, color: REGIME_COLOR[data.read.regime] }} title="The overall read across the real economy">{data.read.regime}</span>
          </div>
          <p className="text-[13px] font-medium leading-snug text-[var(--text)]">{data.read.tldr}</p>
          {data.read.points.length > 0 && (
            <ul className="mt-2 space-y-1 text-[12px] leading-snug">
              {data.read.points.map((p, i) => <li key={i} className="text-[var(--text-2)]"><span className="text-[var(--accent)]">▸</span> {p}</li>)}
            </ul>
          )}
          {data.read.readThrough && data.read.readThrough.length > 0 && (
            <div className="mt-2 border-t border-[var(--divider)] pt-1.5">
              <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--text-4)]">Read-through</div>
              <ul className="space-y-0.5 text-[11.5px]">{data.read.readThrough.map((r, i) => <li key={i} className="text-[var(--text-3)]"><span className="text-[var(--text-4)]">•</span> {r}</li>)}</ul>
            </div>
          )}
          {data.read.caveat && <p className="mt-1.5 text-[11px] italic text-[var(--text-4)]">{data.read.caveat}</p>}
        </div>
      )}
      <div className="space-y-3">
        {GROUP_ORDER.map((group) => {
          const items = data.series.filter((s) => s.group === group);
          const showTsa = group === "Travel" && !!data.tsa;
          if (!items.length && !showTsa) return null;
          return (
            <div key={group}>
              <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-[var(--text-4)]">{group}</div>
              <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {items.map((s) => <SeriesCard key={s.key} s={s} onOpen={() => setDetail(seriesDetail(s))} />)}
                {showTsa && data.tsa && <TsaCard tsa={data.tsa} onOpen={() => setDetail(tsaDetail(data.tsa!))} />}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-4)]">
        Click any card for the full history with selectable timeframes. Free primary sources — FRED (fredgraph) for the monthly series, TSA for daily air-travel throughput. The manufacturing surveys are the regional Fed diffusion indices (Empire / Philly / Dallas), the free stand-in for the licensed ISM PMI; the truck line is BTS&apos;s Freight TSI (a free stand-in for the proprietary ATA Truck Tonnage Index) and the Cass Freight Index (shipments = volume, expenditures = spend) covers all modes; hotel is a lodging-CPI <span className="text-[#f59e0b]">price proxy, not STR RevPAR</span>.
      </p>
      {detail && <DetailModal item={detail} onClose={() => setDetail(null)} />}
    </section>
  );
}
