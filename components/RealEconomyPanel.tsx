"use client";
import { type RealEconomyData, type RealEcoSeries, type TsaThroughput, GROUP_ORDER, REGIME_COLOR, fmtVal, fmtPct, fmtChange, pctColor } from "@/lib/realEconomy";

// Tiny inline sparkline over the trimmed history — green if the window ends above where it started.
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

const asOfLabel = (iso: string | null) => {
  if (!iso) return "";
  const t = Date.parse(iso);
  return Number.isNaN(t) ? "" : new Date(t).toLocaleDateString("en-US", { month: "short", year: "numeric" });
};

function SeriesCard({ s }: { s: RealEcoSeries }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-[var(--text-2)]" title={s.label}>{s.label}</div>
          <div className="mt-0.5 font-mono text-xl font-bold leading-none tabular-nums" style={{ color: s.changeUnit === "pts" ? pctColor(s.latest) : "var(--text)" }} title={s.changeUnit === "pts" ? "Diffusion index: >0 = expansion, <0 = contraction" : undefined}>{fmtVal(s.latest, s.unit)}</div>
          <div className="mt-0.5 text-[10px] text-[var(--text-4)]">{s.unit}{s.latestDate ? ` · ${asOfLabel(s.latestDate)}` : ""}</div>
        </div>
        <Spark points={s.history} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
        <span title="Year-over-year change"><b className="text-[var(--text-4)]">YoY</b> <span className="font-semibold tabular-nums" style={{ color: pctColor(s.yoyPct) }}>{fmtChange(s.yoyPct, s.changeUnit)}</span></span>
        {s.momPct != null && <span title="Month-over-month change"><b className="text-[var(--text-4)]">MoM</b> <span className="tabular-nums" style={{ color: pctColor(s.momPct) }}>{fmtChange(s.momPct, s.changeUnit)}</span></span>}
      </div>
      <div className="mt-1.5 text-[10px] leading-snug text-[var(--text-4)]">
        {s.source}{s.note ? <span className="text-[#f59e0b]" title={s.note}> · {s.note}</span> : null}
      </div>
    </div>
  );
}

function TsaCard({ tsa }: { tsa: TsaThroughput }) {
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="truncate text-[12px] font-medium text-[var(--text-2)]">Air travel · TSA throughput</div>
          <div className="mt-0.5 font-mono text-xl font-bold leading-none tabular-nums text-[var(--text)]">{fmtVal(tsa.avg7, "")}</div>
          <div className="mt-0.5 text-[10px] text-[var(--text-4)]">7-day avg pax/day{tsa.latestDate ? ` · thru ${new Date(tsa.latestDate).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}</div>
        </div>
        <Spark points={tsa.history} />
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px]">
        <span title="7-day average vs ~1 month earlier (the TSA page is year-to-date only, so no true YoY)"><b className="text-[var(--text-4)]">vs 1mo</b> <span className="font-semibold tabular-nums" style={{ color: pctColor(tsa.chg30dPct) }}>{fmtPct(tsa.chg30dPct)}</span></span>
        {tsa.latest != null && <span className="text-[var(--text-4)]">latest day {fmtVal(tsa.latest, "")}</span>}
      </div>
      <div className="mt-1.5 text-[10px] leading-snug text-[var(--text-4)]">{tsa.source} · daily demand proxy (not load factor)</div>
    </div>
  );
}

export default function RealEconomyPanel({ data }: { data: RealEconomyData | null }) {
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
            <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ background: `${REGIME_COLOR[data.read.regime]}22`, color: REGIME_COLOR[data.read.regime] }} title="The overall read across freight, travel & housing">{data.read.regime}</span>
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
                {items.map((s) => <SeriesCard key={s.key} s={s} />)}
                {showTsa && data.tsa && <TsaCard tsa={data.tsa} />}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-2 text-[11px] leading-relaxed text-[var(--text-4)]">
        Free primary sources — FRED (fredgraph) for the monthly series, TSA for daily air-travel throughput. The manufacturing surveys are the regional Fed diffusion indices (Empire / Philly / Dallas), the free stand-in for the licensed ISM PMI; the truck line is BTS&apos;s Freight TSI (a free stand-in for the proprietary ATA Truck Tonnage Index); hotel is a lodging-CPI <span className="text-[#f59e0b]">price proxy, not STR RevPAR</span>. These lead the hard prints.
      </p>
    </section>
  );
}
