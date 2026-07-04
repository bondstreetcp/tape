"use client";
import { useEffect, useMemo, useState } from "react";
import { LoadingState } from "./Spinner";
import type { TimeframeKey } from "@/lib/timeframes";

interface Bar { t: number; c: number }

// Calendar-day lookback per timeframe. YTD is handled separately (anchored to Jan 1).
const WINDOW_DAYS: Record<TimeframeKey, number> = {
  "1d": 1, "1w": 7, "3m": 92, "6m": 183, ytd: 366, "1y": 366, "3y": 1096, "5y": 1827,
};
const DAY = 86_400_000;

/** Headline index price chart, driven by the SHARED page-level timeframe (no separate selector — one
 *  control for the whole dashboard). 1D/1W use the 15-minute intraday series; longer windows use daily
 *  closes. Fed by /api/ohlc (Yahoo). */
export default function IndexChart({ symbol, name, tf }: { symbol: string; name: string; tf: TimeframeKey }) {
  const [data, setData] = useState<{ daily: Bar[]; intraday: Bar[] } | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    let a = true;
    setData(null); setErr(false);
    fetch(`/api/ohlc/${encodeURIComponent(symbol)}?years=5`)
      .then((r) => r.json())
      .then((d) => { if (!a) return; d.daily?.length ? setData({ daily: d.daily, intraday: d.intraday || [] }) : setErr(true); })
      .catch(() => a && setErr(true));
    return () => { a = false; };
  }, [symbol]);

  const series = useMemo(() => {
    if (!data) return [] as Bar[];
    const intra = (tf === "1d" || tf === "1w") && data.intraday.length >= 2;
    const src = intra ? data.intraday : data.daily;
    if (!src.length) return [];
    // Anchor the window to the LAST bar, not now — else a weekend/holiday (feed a day or two stale)
    // would trim a 1D/1W view to nothing.
    const anchor = src[src.length - 1].t;
    const cutoff = tf === "ytd" ? Date.UTC(new Date(anchor).getUTCFullYear(), 0, 1) : anchor - WINDOW_DAYS[tf] * DAY;
    const s = src.filter((b) => b.t >= cutoff);
    return s.length >= 2 ? s : src.slice(-2); // never render a stub
  }, [data, tf]);

  const first = series[0]?.c, last = series[series.length - 1]?.c;
  const chg = first != null && last != null && first !== 0 ? (last / first - 1) * 100 : null;
  const up = (chg ?? 0) >= 0;
  const fmtVal = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex items-center gap-2">
        <h2 className="text-base font-bold text-[var(--text)]">{name}</h2>
        <span className="font-mono text-[11px] text-[var(--text-4)]">{symbol}</span>
      </div>
      {last != null && (
        <div className="mb-2 flex flex-wrap items-baseline gap-2">
          <span className="font-mono text-xl font-semibold tabular-nums text-[var(--text)]">{fmtVal(last)}</span>
          {chg != null && (
            <span className="text-sm font-medium tabular-nums" style={{ color: up ? "#22c55e" : "#ef4444" }}>
              {up ? "▲" : "▼"} {up ? "+" : ""}{chg.toFixed(2)}% <span className="text-[var(--text-4)]">· {tf.toUpperCase()}</span>
            </span>
          )}
        </div>
      )}
      {err ? (
        <div className="py-12 text-center text-sm text-[var(--text-3)]">No chart data for this index.</div>
      ) : !data ? (
        <LoadingState label="Loading chart…" className="py-12" />
      ) : (
        <Line series={series} up={up} fmtVal={fmtVal} />
      )}
    </section>
  );
}

function Line({ series, up, fmtVal }: { series: Bar[]; up: boolean; fmtVal: (v: number) => string }) {
  if (series.length < 2) return <div className="py-12 text-center text-sm text-[var(--text-3)]">Not enough data for this range.</div>;
  const W = 900, H = 260, ML = 58, MR = 12, MT = 12, MB = 22;
  const n = series.length;
  const cs = series.map((b) => b.c);
  let lo = Math.min(...cs), hi = Math.max(...cs);
  const pad = (hi - lo) * 0.08 || Math.abs(hi) * 0.05 || 1;
  lo -= pad; hi += pad;
  const x = (i: number) => ML + (i / Math.max(1, n - 1)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - lo) / (hi - lo || 1)) * (H - MT - MB);
  const line = series.map((b, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(b.c).toFixed(1)}`).join("");
  const area = `${line}L${x(n - 1).toFixed(1)} ${(H - MB).toFixed(1)}L${x(0).toFixed(1)} ${(H - MB).toFixed(1)}Z`;
  const col = up ? "#22c55e" : "#ef4444";
  const yvals = Array.from({ length: 5 }, (_, i) => lo + (i / 4) * (hi - lo));
  // Axis label precision scales with the visible span: intraday → time, ≤~4mo → month+day, else month+year.
  const spanDays = (series[n - 1].t - series[0].t) / DAY;
  const fmtD = (t: number) => {
    const d = new Date(t);
    if (spanDays <= 2) return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (spanDays <= 130) return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
    return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  };
  const xticks = [0, Math.floor(n / 3), Math.floor((2 * n) / 3), n - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
      {yvals.map((v, i) => (
        <g key={i}>
          <line x1={ML} x2={W - MR} y1={y(v)} y2={y(v)} stroke="var(--surface-hover)" strokeWidth={1} />
          <text x={ML - 6} y={y(v) + 3} textAnchor="end" fontSize={11} fill="var(--text-4)">{fmtVal(v)}</text>
        </g>
      ))}
      {xticks.map((i, k) => (
        <text key={k} x={x(i)} y={H - 6} textAnchor="middle" fontSize={11} fill="var(--text-4)">{fmtD(series[i].t)}</text>
      ))}
      <defs>
        <linearGradient id="ic-area" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={col} stopOpacity={0.18} />
          <stop offset="100%" stopColor={col} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#ic-area)" />
      <path d={line} fill="none" stroke={col} strokeWidth={1.6} />
    </svg>
  );
}
