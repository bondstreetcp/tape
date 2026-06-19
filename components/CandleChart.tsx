"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SeriesPoint } from "@/lib/types";
import type { TimeframeKey } from "@/lib/timeframes";
import { sliceSeries } from "@/lib/compute";
import { sma } from "@/lib/indicators";
import { fmtPrice } from "@/lib/format";

interface Bar { t: number; o: number; h: number; l: number; c: number; v: number }

const SMA_DEFS: { period: number; color: string }[] = [
  { period: 20, color: "#38bdf8" },
  { period: 50, color: "#fbbf24" },
  { period: 150, color: "#fb923c" },
  { period: 200, color: "#f472b6" },
];

const VBW = 1000, ML = 8, MR = 54, MT = 6, PH = 252, VGAP = 16, VH = 64;
const VOL_TOP = MT + PH + VGAP;
const VBH = VOL_TOP + VH + 20;

function fmtVol(v: number): string {
  if (!v) return "—";
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`;
  if (v >= 1e6) return `${(v / 1e6).toFixed(1)}M`;
  if (v >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return `${v}`;
}

function xLabel(t: number, tf: TimeframeKey): string {
  const d = new Date(t);
  if (tf === "1d") return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  if (tf === "1w") return d.toLocaleDateString(undefined, { weekday: "short" });
  if (tf === "3y" || tf === "5y") return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export default function CandleChart({
  symbol,
  tf,
  now,
}: {
  symbol: string;
  tf: TimeframeKey;
  now: number;
}) {
  const [data, setData] = useState<{ daily: Bar[]; intraday: Bar[] } | null>(null);
  const [loading, setLoading] = useState(true);
  const [smaOn, setSmaOn] = useState<Set<number>>(new Set([50]));
  const [hover, setHover] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    fetch(`/api/ohlc/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => alive && setData({ daily: d.daily || [], intraday: d.intraday || [] }))
      .catch(() => alive && setData({ daily: [], intraday: [] }))
      .finally(() => alive && setLoading(false));
    return () => { alive = false; };
  }, [symbol]);

  const source = useMemo<Bar[]>(() => {
    if (!data) return [];
    return (tf === "1d" || tf === "1w") && data.intraday.length ? data.intraday : data.daily;
  }, [data, tf]);

  const windowStart = useMemo(() => {
    if (!source.length) return 0;
    const pts: SeriesPoint[] = source.map((b) => ({ t: b.t, c: b.c }));
    const dailyPts: SeriesPoint[] = (data?.daily ?? []).map((b) => ({ t: b.t, c: b.c }));
    const intradayPts: SeriesPoint[] = (data?.intraday ?? []).map((b) => ({ t: b.t, c: b.c }));
    const win = sliceSeries(intradayPts, dailyPts, tf, now);
    if (!win.length) return 0;
    const t0 = win[0].t;
    const idx = pts.findIndex((p) => p.t >= t0);
    return idx < 0 ? 0 : idx;
  }, [source, data, tf, now]);

  const smas = useMemo(() => {
    const closes = source.map((b) => b.c);
    const out: Record<number, (number | null)[]> = {};
    for (const { period } of SMA_DEFS) if (smaOn.has(period)) out[period] = sma(closes, period);
    return out;
  }, [source, smaOn]);

  const view = useMemo(() => {
    const bars = source.slice(windowStart);
    if (bars.length < 2) return null;
    const n = bars.length;
    let pMin = Infinity, pMax = -Infinity, vMax = 0;
    for (const b of bars) {
      if (b.l < pMin) pMin = b.l;
      if (b.h > pMax) pMax = b.h;
      if (b.v > vMax) vMax = b.v;
    }
    const pad = (pMax - pMin) * 0.04 || 1;
    pMin -= pad; pMax += pad;
    const plotW = VBW - ML - MR;
    const x = (i: number) => ML + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const yP = (p: number) => MT + (1 - (p - pMin) / (pMax - pMin || 1)) * PH;
    const yV = (v: number) => VOL_TOP + VH - (v / (vMax || 1)) * VH;
    const cw = Math.max(1, (plotW / n) * 0.64);

    const smaPaths = SMA_DEFS.filter((d) => smaOn.has(d.period) && smas[d.period]).map((d) => {
      const arr = smas[d.period];
      let path = "";
      for (let i = 0; i < n; i++) {
        const val = arr[windowStart + i];
        if (val == null) continue;
        path += `${path ? "L" : "M"}${x(i).toFixed(1)} ${yP(val).toFixed(1)}`;
      }
      return { color: d.color, path, period: d.period };
    });

    const yTicks = [0, 0.25, 0.5, 0.75, 1].map((f) => {
      const p = pMin + f * (pMax - pMin);
      return { y: yP(p), label: `$${p >= 100 ? p.toFixed(0) : p.toFixed(1)}` };
    });
    const xTickIdx: number[] = [];
    const want = 6;
    for (let k = 0; k < want; k++) xTickIdx.push(Math.round((k / (want - 1)) * (n - 1)));

    return { bars, n, x, yP, yV, cw, smaPaths, yTicks, xTickIdx, plotW };
  }, [source, windowStart, smas, smaOn]);

  const onMove = (e: React.MouseEvent) => {
    if (!view || !svgRef.current) return;
    const rect = svgRef.current.getBoundingClientRect();
    const vx = ((e.clientX - rect.left) / rect.width) * VBW;
    const i = Math.round(((vx - ML) / view.plotW) * (view.n - 1));
    setHover(Math.max(0, Math.min(view.n - 1, i)));
  };

  if (loading) {
    return <div className="flex h-[320px] items-center justify-center text-sm text-[#8b93a7]">Loading OHLC data…</div>;
  }
  if (!view) {
    return <div className="flex h-[320px] items-center justify-center text-sm text-[#8b93a7]">No candle data for this range.</div>;
  }

  const hb = view.bars[hover ?? view.n - 1];
  const up = hb.c >= hb.o;
  const chg = hb.o ? ((hb.c - hb.o) / hb.o) * 100 : 0;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-0.5 font-mono text-xs tabular-nums">
          <span className="text-[#8b93a7]">{new Date(hb.t).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" })}</span>
          <Read label="O" v={hb.o} /><Read label="H" v={hb.h} /><Read label="L" v={hb.l} />
          <span style={{ color: up ? "#22c55e" : "#ef4444" }}>C {fmtPrice(hb.c)}</span>
          <span style={{ color: up ? "#22c55e" : "#ef4444" }}>{chg >= 0 ? "+" : ""}{chg.toFixed(2)}%</span>
          <span className="text-[#8b93a7]">Vol {fmtVol(hb.v)}</span>
        </div>
        <div className="flex items-center gap-1">
          {SMA_DEFS.map((d) => (
            <button
              key={d.period}
              onClick={() => setSmaOn((p) => { const n = new Set(p); n.has(d.period) ? n.delete(d.period) : n.add(d.period); return n; })}
              className="rounded border px-1.5 py-0.5 text-[11px] font-medium transition-colors"
              style={{
                borderColor: smaOn.has(d.period) ? d.color : "#2a2e39",
                color: smaOn.has(d.period) ? d.color : "#8b93a7",
                background: smaOn.has(d.period) ? d.color + "1a" : "transparent",
              }}
            >
              SMA{d.period}
            </button>
          ))}
        </div>
      </div>

      <svg
        ref={svgRef}
        viewBox={`0 0 ${VBW} ${VBH}`}
        className="w-full"
        style={{ height: "auto" }}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        {/* price gridlines */}
        {view.yTicks.map((t, i) => (
          <g key={i}>
            <line x1={ML} x2={VBW - MR} y1={t.y} y2={t.y} stroke="#1a1f2b" strokeWidth={1} />
            <text x={VBW - MR + 4} y={t.y + 3} fontSize={10} fill="#5b6478">{t.label}</text>
          </g>
        ))}
        {/* candles */}
        {view.bars.map((b, i) => {
          const x = view.x(i);
          const green = b.c >= b.o;
          const col = green ? "#26a269" : "#e0533d";
          const bodyTop = view.yP(Math.max(b.o, b.c));
          const bodyH = Math.max(1, Math.abs(view.yP(b.o) - view.yP(b.c)));
          return (
            <g key={i}>
              <line x1={x} x2={x} y1={view.yP(b.h)} y2={view.yP(b.l)} stroke={col} strokeWidth={1} />
              <rect x={x - view.cw / 2} y={bodyTop} width={view.cw} height={bodyH} fill={col} />
            </g>
          );
        })}
        {/* SMA overlays */}
        {view.smaPaths.map((s) => (
          <path key={s.period} d={s.path} fill="none" stroke={s.color} strokeWidth={1.3} opacity={0.9} />
        ))}
        {/* volume */}
        {view.bars.map((b, i) => {
          const x = view.x(i);
          const y = view.yV(b.v);
          return <rect key={i} x={x - view.cw / 2} y={y} width={view.cw} height={VOL_TOP + VH - y} fill={b.c >= b.o ? "#26a269" : "#e0533d"} opacity={0.45} />;
        })}
        <text x={ML} y={VOL_TOP - 4} fontSize={10} fill="#5b6478">Volume</text>
        {/* x labels */}
        {view.xTickIdx.map((idx) => (
          <text key={idx} x={view.x(idx)} y={VBH - 6} fontSize={10} fill="#5b6478" textAnchor="middle">
            {xLabel(view.bars[idx].t, tf)}
          </text>
        ))}
        {/* crosshair */}
        {hover != null && (
          <line x1={view.x(hover)} x2={view.x(hover)} y1={MT} y2={VOL_TOP + VH} stroke="#5b6478" strokeWidth={0.75} strokeDasharray="3 3" />
        )}
      </svg>
    </div>
  );
}

function Read({ label, v }: { label: string; v: number }) {
  return (
    <span className="text-[#aab2c5]">
      <span className="text-[#5b6478]">{label}</span> {fmtPrice(v)}
    </span>
  );
}
