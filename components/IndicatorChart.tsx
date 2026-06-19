"use client";
import { useMemo, useState } from "react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SeriesPoint } from "@/lib/types";
import type { TimeframeKey } from "@/lib/timeframes";
import { fmtPrice } from "@/lib/format";
import {
  OVERLAYS,
  PANELS,
  sma,
  ema,
  bollinger,
  macd,
  rsi,
  type IndicatorId,
  type OverlayId,
} from "@/lib/indicators";

function tickFmt(tf: TimeframeKey) {
  return (t: number) => {
    const d = new Date(t);
    if (tf === "1d")
      return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (tf === "1w")
      return d.toLocaleDateString(undefined, { weekday: "short" });
    if (tf === "3y" || tf === "5y")
      return d.toLocaleDateString(undefined, { month: "short", year: "2-digit" });
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
}

const overlayCloses = (id: OverlayId, c: number[]) => {
  switch (id) {
    case "sma20":
      return { keys: [["sma20", sma(c, 20), "#38bdf8", false]] as const };
    case "sma50":
      return { keys: [["sma50", sma(c, 50), "#fbbf24", false]] as const };
    case "sma200":
      return { keys: [["sma200", sma(c, 200), "#f472b6", false]] as const };
    case "ema12":
      return { keys: [["ema12", ema(c, 12), "#4ade80", false]] as const };
    case "ema26":
      return { keys: [["ema26", ema(c, 26), "#c084fc", false]] as const };
    case "bb": {
      const b = bollinger(c, 20, 2);
      return {
        keys: [
          ["bb_u", b.upper, "#8b93a7", true],
          ["bb_l", b.lower, "#8b93a7", true],
        ] as const,
      };
    }
  }
};

export default function IndicatorChart({
  points,
  tf,
  up,
}: {
  points: SeriesPoint[];
  tf: TimeframeKey;
  up: boolean;
}) {
  const [enabled, setEnabled] = useState<Set<IndicatorId>>(new Set(["sma50"]));

  const toggle = (id: IndicatorId) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const closes = useMemo(() => points.map((p) => p.c), [points]);

  const { priceData, lineSeries } = useMemo(() => {
    const cols: Record<string, (number | null)[]> = {};
    const lineSeries: { key: string; color: string; dash: boolean }[] = [];
    for (const o of OVERLAYS) {
      if (!enabled.has(o.id)) continue;
      const res = overlayCloses(o.id, closes);
      for (const [key, data, color, dash] of res.keys) {
        cols[key] = data as (number | null)[];
        lineSeries.push({ key, color: color as string, dash: dash as boolean });
      }
    }
    const priceData = points.map((p, i) => {
      const row: Record<string, number | null> = { t: p.t, c: p.c };
      for (const k in cols) row[k] = cols[k][i];
      return row;
    });
    return { priceData, lineSeries };
  }, [points, closes, enabled]);

  const macdData = useMemo(() => {
    if (!enabled.has("macd")) return null;
    const m = macd(closes);
    return points.map((p, i) => ({
      t: p.t,
      macd: m.macd[i],
      signal: m.signal[i],
      hist: m.hist[i],
    }));
  }, [points, closes, enabled]);

  const rsiData = useMemo(() => {
    if (!enabled.has("rsi")) return null;
    const r = rsi(closes, 14);
    return points.map((p, i) => ({ t: p.t, rsi: r[i] }));
  }, [points, closes, enabled]);

  const color = up ? "#22c55e" : "#ef4444";
  const fmt = tickFmt(tf);
  const xAxis = (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={["dataMin", "dataMax"]}
      tickFormatter={fmt}
      tick={{ fill: "#8b93a7", fontSize: 11 }}
      stroke="#2a2e39"
      minTickGap={48}
    />
  );

  return (
    <div>
      {/* indicator toggles */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {OVERLAYS.map((o) => (
          <Chip
            key={o.id}
            active={enabled.has(o.id)}
            color={o.color}
            onClick={() => toggle(o.id)}
          >
            {o.label}
          </Chip>
        ))}
        <span className="mx-1 text-[#3a4150]">|</span>
        {PANELS.map((p) => (
          <Chip key={p.id} active={enabled.has(p.id)} onClick={() => toggle(p.id)}>
            {p.label}
          </Chip>
        ))}
      </div>

      {points.length < 2 ? (
        <div className="flex h-[300px] items-center justify-center text-sm text-[#8b93a7]">
          No price data for this range.
        </div>
      ) : (
        <>
          <ResponsiveContainer width="100%" height={300}>
            <ComposedChart data={priceData} margin={{ top: 6, right: 12, bottom: 0, left: 4 }}>
              <defs>
                <linearGradient id="px" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={color} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={color} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="#1f2430" vertical={false} />
              {xAxis}
              <YAxis
                orientation="right"
                domain={["auto", "auto"]}
                tick={{ fill: "#8b93a7", fontSize: 11 }}
                stroke="#2a2e39"
                tickFormatter={(v: number) => `$${v.toFixed(0)}`}
                width={48}
              />
              <Tooltip content={<PriceTip tf={tf} series={lineSeries} />} isAnimationActive={false} />
              <Area
                type="monotone"
                dataKey="c"
                stroke={color}
                strokeWidth={2}
                fill="url(#px)"
                isAnimationActive={false}
                dot={false}
              />
              {lineSeries.map((s) => (
                <Line
                  key={s.key}
                  type="monotone"
                  dataKey={s.key}
                  stroke={s.color}
                  strokeWidth={1.4}
                  strokeDasharray={s.dash ? "4 3" : undefined}
                  dot={false}
                  connectNulls
                  isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </ResponsiveContainer>

          {macdData && (
            <Panel title="MACD (12, 26, 9)">
              <ResponsiveContainer width="100%" height={130}>
                <ComposedChart data={macdData} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke="#1f2430" vertical={false} />
                  {xAxis}
                  <YAxis orientation="right" tick={{ fill: "#8b93a7", fontSize: 10 }} stroke="#2a2e39" width={48} />
                  <ReferenceLine y={0} stroke="#3a4150" />
                  <Tooltip isAnimationActive={false} contentStyle={tipStyle} />
                  <Bar dataKey="hist" isAnimationActive={false}>
                    {macdData.map((d, i) => (
                      <Cell
                        key={i}
                        fill={(d.hist ?? 0) >= 0 ? "#22c55e" : "#ef4444"}
                      />
                    ))}
                  </Bar>
                  <Line type="monotone" dataKey="macd" stroke="#60a5fa" strokeWidth={1.3} dot={false} connectNulls isAnimationActive={false} />
                  <Line type="monotone" dataKey="signal" stroke="#fbbf24" strokeWidth={1.3} dot={false} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </Panel>
          )}

          {rsiData && (
            <Panel title="RSI (14)">
              <ResponsiveContainer width="100%" height={110}>
                <ComposedChart data={rsiData} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke="#1f2430" vertical={false} />
                  {xAxis}
                  <YAxis orientation="right" domain={[0, 100]} ticks={[30, 50, 70]} tick={{ fill: "#8b93a7", fontSize: 10 }} stroke="#2a2e39" width={48} />
                  <ReferenceLine y={70} stroke="#ef4444" strokeDasharray="3 3" />
                  <ReferenceLine y={30} stroke="#22c55e" strokeDasharray="3 3" />
                  <Tooltip isAnimationActive={false} contentStyle={tipStyle} />
                  <Line type="monotone" dataKey="rsi" stroke="#c084fc" strokeWidth={1.4} dot={false} connectNulls isAnimationActive={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </Panel>
          )}
        </>
      )}
    </div>
  );
}

const tipStyle = {
  background: "#0b0e14",
  border: "1px solid #2a2e39",
  borderRadius: 6,
  fontSize: 12,
};

function Chip({
  active,
  color,
  onClick,
  children,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors " +
        (active
          ? "border-[#3a4256] bg-[#1a1f2e] text-[#e6e9f0]"
          : "border-[#2a2e39] bg-[#131722] text-[#8b93a7] hover:text-[#e6e9f0]")
      }
    >
      {color && (
        <span
          className="h-2 w-2 rounded-sm"
          style={{ background: active ? color : "#3a4150" }}
        />
      )}
      {children}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 border-t border-[#1f2430] pt-2">
      <div className="mb-1 text-xs text-[#8b93a7]">{title}</div>
      {children}
    </div>
  );
}

function PriceTip({ active, payload, label, tf, series }: any) {
  if (!active || !payload?.length) return null;
  const price = payload.find((p: any) => p.dataKey === "c")?.value;
  const d = new Date(label);
  const dateStr =
    tf === "1d" || tf === "1w"
      ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return (
    <div className="rounded-md border border-[#2a2e39] bg-[#0b0e14] px-3 py-2 text-xs shadow-lg">
      <div className="text-[#8b93a7]">{dateStr}</div>
      <div className="font-mono text-sm font-semibold">${fmtPrice(price)}</div>
      {series.map((s: any) => {
        const v = payload.find((p: any) => p.dataKey === s.key)?.value;
        if (v == null) return null;
        return (
          <div key={s.key} className="flex items-center gap-1.5" style={{ color: s.color }}>
            <span className="font-mono">{s.key.replace("_u", " up").replace("_l", " low")}</span>
            <span className="tabular-nums">${fmtPrice(v)}</span>
          </div>
        );
      })}
    </div>
  );
}
