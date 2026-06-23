"use client";
import { useEffect, useMemo, useState } from "react";
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
import { fmtMoney } from "@/lib/format";
import { priorCloseFor, sliceSeries, windowChangePct } from "@/lib/compute";
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
    case "sma150":
      return { keys: [["sma150", sma(c, 150), "#fb923c", false]] as const };
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
          ["bb_u", b.upper, "var(--text-3)", true],
          ["bb_l", b.lower, "var(--text-3)", true],
        ] as const,
      };
    }
  }
};

export default function IndicatorChart({
  daily,
  intraday,
  tf,
  now,
  up,
  symbol,
  currency = "USD",
  onRangeChange,
}: {
  daily: SeriesPoint[];
  intraday: SeriesPoint[];
  tf: TimeframeKey;
  now: number;
  up: boolean;
  symbol?: string;
  currency?: string;
  onRangeChange?: (pct: number | null) => void;
}) {
  const [enabled, setEnabled] = useState<Set<IndicatorId>>(new Set(["sma50"]));

  // Volume isn't in the stored close-only series — fetch OHLCV on demand.
  const [ohlc, setOhlc] = useState<{ daily: any[]; intraday: any[] } | null>(null);
  useEffect(() => {
    if (!symbol) return;
    let alive = true;
    fetch(`/api/ohlc/${encodeURIComponent(symbol)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => alive && d && setOhlc({ daily: d.daily || [], intraday: d.intraday || [] }))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [symbol]);

  const toggle = (id: IndicatorId) =>
    setEnabled((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Indicators are computed over the FULL series, then sliced to the visible
  // window — so the 50/150/200-day SMAs are warmed up by the history that
  // precedes the window instead of starting blank inside it.
  // The day-based moving averages only make sense on the DAILY series — over the
  // intraday (1D/1W) bars a "50-day" SMA becomes a misleading 50-bar (~2-day)
  // average, so the MA overlays are disabled on those timeframes (see the chips).
  // On 1D/1W use the LIVE intraday from the on-demand OHLC fetch (already pulled above for volume)
  // — the stored series only rebuilds after the close, so it would otherwise show the prior
  // session. Falls back to the static series until the live bars land (or if the fetch fails).
  const liveIntraday = useMemo<SeriesPoint[] | null>(
    () => (ohlc?.intraday?.length ? ohlc.intraday.map((b: any) => ({ t: b.t, c: b.c })) : null),
    [ohlc],
  );
  const effIntraday = liveIntraday ?? intraday;
  const intradayTf = tf === "1d" || tf === "1w";
  const source = intradayTf ? effIntraday : daily;
  const closes = useMemo(() => source.map((p) => p.c), [source]);

  const windowStart = useMemo(() => {
    if (!source.length) return 0;
    const win = sliceSeries(effIntraday, daily, tf, now);
    if (!win.length) return 0;
    const t0 = win[0].t;
    const idx = source.findIndex((p) => p.t >= t0);
    return idx < 0 ? 0 : idx;
  }, [effIntraday, daily, tf, now, source]);

  const points = useMemo(() => source.slice(windowStart), [source, windowStart]);

  // Prior session's close — the 1D line plots today's session from the open, so a dashed reference
  // line here makes the overnight gap (and the vs-prev-close move shown in the header) visible.
  const prevClose = useMemo(() => priorCloseFor(effIntraday, daily, tf, now), [effIntraday, daily, tf, now]);

  // Report the displayed window's % change (vs the period baseline — prior close for 1D) so the
  // parent's "this range" badge reflects this LIVE chart, not the day-stale stored series.
  const rangeChange = useMemo(() => windowChangePct(effIntraday, daily, tf, now), [effIntraday, daily, tf, now]);
  useEffect(() => { onRangeChange?.(rangeChange); }, [rangeChange, onRangeChange]);

  const volumeData = useMemo(() => {
    if (!ohlc) return null;
    const src = tf === "1d" || tf === "1w" ? ohlc.intraday : ohlc.daily;
    if (!src?.length || points.length < 2) return null;
    const t0 = points[0].t;
    const t1 = points[points.length - 1].t;
    const rows = src
      .filter((b: any) => b.t >= t0 && b.t <= t1 && b.v != null)
      .map((b: any) => ({ t: b.t, v: b.v, vup: b.c >= b.o }));
    return rows.length ? rows : null;
  }, [ohlc, tf, points]);

  const { priceData, lineSeries } = useMemo(() => {
    const cols: Record<string, (number | null)[]> = {};
    const lineSeries: { key: string; color: string; dash: boolean }[] = [];
    for (const o of OVERLAYS) {
      if (intradayTf || !enabled.has(o.id)) continue;
      const res = overlayCloses(o.id, closes);
      for (const [key, data, color, dash] of res.keys) {
        cols[key] = data as (number | null)[];
        lineSeries.push({ key, color: color as string, dash: dash as boolean });
      }
    }
    const priceData: Record<string, number | null>[] = [];
    for (let i = windowStart; i < source.length; i++) {
      const row: Record<string, number | null> = { t: source[i].t, c: source[i].c };
      for (const k in cols) row[k] = cols[k][i];
      priceData.push(row);
    }
    return { priceData, lineSeries };
  }, [source, windowStart, closes, enabled]);

  const macdData = useMemo(() => {
    if (!enabled.has("macd")) return null;
    const m = macd(closes);
    const out = [];
    for (let i = windowStart; i < source.length; i++)
      out.push({ t: source[i].t, macd: m.macd[i], signal: m.signal[i], hist: m.hist[i] });
    return out;
  }, [source, windowStart, closes, enabled]);

  const rsiData = useMemo(() => {
    if (!enabled.has("rsi")) return null;
    const r = rsi(closes, 14);
    const out = [];
    for (let i = windowStart; i < source.length; i++)
      out.push({ t: source[i].t, rsi: r[i] });
    return out;
  }, [source, windowStart, closes, enabled]);

  // X-axis: on the 1W intraday view, place one tick per trading day — otherwise the
  // many 15-min bars all format to the same weekday and repeat ("Mon Mon Mon Tue …").
  const xTicks = useMemo(() => {
    if (tf !== "1w") return undefined;
    const seen = new Set<string>();
    const ticks: number[] = [];
    for (const row of priceData) {
      const t = row.t as number;
      const d = new Date(t);
      const key = `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
      if (!seen.has(key)) { seen.add(key); ticks.push(t); }
    }
    return ticks.length ? ticks : undefined;
  }, [priceData, tf]);

  // Y-axis: use enough decimals that ticks stay distinct on a narrow range — a $44–46
  // ETF with 0 decimals rounds every tick to "$45".
  const priceDecimals = useMemo(() => {
    let lo = Infinity, hi = -Infinity;
    for (const p of points) { if (p.c < lo) lo = p.c; if (p.c > hi) hi = p.c; }
    const range = hi - lo;
    if (!Number.isFinite(range) || range <= 0) return 2;
    return range >= 50 ? 0 : range >= 8 ? 1 : 2;
  }, [points]);

  const color = up ? "#22c55e" : "#ef4444";
  const fmt = tickFmt(tf);
  const xAxis = (
    <XAxis
      dataKey="t"
      type="number"
      scale="time"
      domain={["dataMin", "dataMax"]}
      ticks={xTicks}
      tickFormatter={fmt}
      tick={{ fill: "var(--text-3)", fontSize: 11 }}
      stroke="var(--border)"
      minTickGap={xTicks ? 12 : 48}
    />
  );

  return (
    <div>
      {/* indicator toggles */}
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {OVERLAYS.map((o) => (
          <Chip
            key={o.id}
            active={enabled.has(o.id) && !intradayTf}
            color={o.color}
            disabled={intradayTf}
            title={intradayTf ? "Moving averages apply to the daily timeframes — switch to 3M or longer." : undefined}
            onClick={() => { if (!intradayTf) toggle(o.id); }}
          >
            {o.label}
          </Chip>
        ))}
        <span className="mx-1 text-[var(--border-strong)]">|</span>
        {PANELS.map((p) => (
          <Chip key={p.id} active={enabled.has(p.id)} onClick={() => toggle(p.id)}>
            {p.label}
          </Chip>
        ))}
      </div>

      {points.length < 2 ? (
        <div className="flex h-[300px] items-center justify-center text-sm text-[var(--text-3)]">
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
              <CartesianGrid stroke="var(--divider)" vertical={false} />
              {xAxis}
              <YAxis
                orientation="right"
                domain={
                  prevClose != null
                    ? [(min: number) => Math.min(min, prevClose), (max: number) => Math.max(max, prevClose)]
                    : ["auto", "auto"]
                }
                tick={{ fill: "var(--text-3)", fontSize: 11 }}
                stroke="var(--border)"
                tickFormatter={(v: number) => fmtMoney(v, currency, priceDecimals)}
                width={52}
              />
              <Tooltip content={<PriceTip tf={tf} series={lineSeries} currency={currency} />} isAnimationActive={false} />
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
              {prevClose != null && (
                <ReferenceLine
                  y={prevClose}
                  stroke="var(--text-4)"
                  strokeDasharray="4 4"
                  strokeWidth={1}
                  ifOverflow="extendDomain"
                  label={{ value: "prev close", position: "insideTopLeft", fill: "var(--text-4)", fontSize: 10 }}
                />
              )}
            </ComposedChart>
          </ResponsiveContainer>

          {volumeData && (
            <Panel title="Volume">
              <ResponsiveContainer width="100%" height={84}>
                <ComposedChart data={volumeData} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke="var(--divider)" vertical={false} />
                  {xAxis}
                  <YAxis
                    orientation="right"
                    tick={{ fill: "var(--text-3)", fontSize: 10 }}
                    stroke="var(--border)"
                    width={48}
                    tickFormatter={fmtVolAxis}
                  />
                  <Tooltip
                    isAnimationActive={false}
                    contentStyle={tipStyle}
                    formatter={(v: any) => [fmtVolAxis(v), "Volume"]}
                    labelFormatter={() => ""}
                  />
                  <Bar dataKey="v" isAnimationActive={false}>
                    {volumeData.map((d, i) => (
                      <Cell key={i} fill={d.vup ? "#22c55e" : "#ef4444"} fillOpacity={0.5} />
                    ))}
                  </Bar>
                </ComposedChart>
              </ResponsiveContainer>
            </Panel>
          )}

          {macdData && (
            <Panel title="MACD (12, 26, 9)">
              <ResponsiveContainer width="100%" height={130}>
                <ComposedChart data={macdData} margin={{ top: 4, right: 12, bottom: 0, left: 4 }}>
                  <CartesianGrid stroke="var(--divider)" vertical={false} />
                  {xAxis}
                  <YAxis orientation="right" tick={{ fill: "var(--text-3)", fontSize: 10 }} stroke="var(--border)" width={48} />
                  <ReferenceLine y={0} stroke="var(--border-strong)" />
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
                  <CartesianGrid stroke="var(--divider)" vertical={false} />
                  {xAxis}
                  <YAxis orientation="right" domain={[0, 100]} ticks={[30, 50, 70]} tick={{ fill: "var(--text-3)", fontSize: 10 }} stroke="var(--border)" width={48} />
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
  background: "var(--bg)",
  border: "1px solid var(--border)",
  borderRadius: 6,
  fontSize: 12,
};

function fmtVolAxis(v: number): string {
  if (v == null) return "";
  const a = Math.abs(v);
  if (a >= 1e9) return `${(v / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${(v / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(0)}K`;
  return `${v}`;
}

function Chip({
  active,
  color,
  onClick,
  children,
  disabled,
  title,
}: {
  active: boolean;
  color?: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 " +
        (active
          ? "border-[var(--border-strong)] bg-[var(--surface-hover)] text-[var(--text)]"
          : "border-[var(--border)] bg-[var(--surface)] text-[var(--text-3)] hover:text-[var(--text)]")
      }
    >
      {color && (
        <span
          className="h-2 w-2 rounded-sm"
          style={{ background: active ? color : "var(--border-strong)" }}
        />
      )}
      {children}
    </button>
  );
}

function Panel({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mt-2 border-t border-[var(--divider)] pt-2">
      <div className="mb-1 text-xs text-[var(--text-3)]">{title}</div>
      {children}
    </div>
  );
}

function PriceTip({ active, payload, label, tf, series, currency = "USD" }: any) {
  if (!active || !payload?.length) return null;
  const price = payload.find((p: any) => p.dataKey === "c")?.value;
  const d = new Date(label);
  const dateStr =
    tf === "1d" || tf === "1w"
      ? d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })
      : d.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
  return (
    <div className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-xs shadow-lg">
      <div className="text-[var(--text-3)]">{dateStr}</div>
      <div className="font-mono text-sm font-semibold">{fmtMoney(price, currency)}</div>
      {series.map((s: any) => {
        const v = payload.find((p: any) => p.dataKey === s.key)?.value;
        if (v == null) return null;
        return (
          <div key={s.key} className="flex items-center gap-1.5" style={{ color: s.color }}>
            <span className="font-mono">{s.key.replace("_u", " up").replace("_l", " low")}</span>
            <span className="tabular-nums">{fmtMoney(v, currency)}</span>
          </div>
        );
      })}
    </div>
  );
}
