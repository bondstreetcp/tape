"use client";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { TimeframeKey } from "@/lib/timeframes";

export interface SeriesDef {
  symbol: string;
  color: string;
  isRef?: boolean;
}

function tickFmt(tf: TimeframeKey) {
  return (t: number) => {
    const d = new Date(t);
    if (tf === "1d")
      return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
    if (tf === "1w")
      return d.toLocaleDateString(undefined, { weekday: "short" });
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  };
}

function pct(v: number) {
  return `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
}

function CustomTooltip({ active, payload, label, tf, colors }: any) {
  if (!active || !payload?.length) return null;
  const d = new Date(label);
  const dateStr =
    tf === "1d" || tf === "1w"
      ? d.toLocaleString(undefined, {
          month: "short",
          day: "numeric",
          hour: "numeric",
          minute: "2-digit",
        })
      : d.toLocaleDateString(undefined, {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
  const items = [...payload]
    .filter((p: any) => typeof p.value === "number")
    .sort((a: any, b: any) => b.value - a.value)
    .slice(0, 16);
  return (
    <div className="rounded-md border border-[#2a2e39] bg-[#0b0e14] px-3 py-2 text-xs shadow-xl">
      <div className="mb-1 text-[#8b93a7]">{dateStr}</div>
      <div className="grid grid-cols-[auto_auto] gap-x-3 gap-y-0.5">
        {items.map((p: any) => (
          <div key={p.dataKey} className="contents">
            <span className="flex items-center gap-1.5">
              <span
                className="inline-block h-2 w-2 rounded-sm"
                style={{ background: colors[p.dataKey] || p.color }}
              />
              <span className="font-mono">{p.dataKey}</span>
            </span>
            <span
              className="text-right tabular-nums"
              style={{ color: p.value >= 0 ? "#22c55e" : "#ef4444" }}
            >
              {pct(p.value)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function MultiLineChart({
  rows,
  series,
  tf,
  hidden,
  highlight,
}: {
  rows: Array<Record<string, number>>;
  series: SeriesDef[];
  tf: TimeframeKey;
  hidden: Set<string>;
  highlight: string | null;
}) {
  const colorMap: Record<string, string> = Object.fromEntries(
    series.map((s) => [s.symbol, s.color]),
  );

  if (rows.length < 2) {
    return (
      <div className="flex h-[440px] items-center justify-center text-sm text-[#8b93a7]">
        No price history for this range.
      </div>
    );
  }

  const visible = series.filter((s) => !hidden.has(s.symbol));

  return (
    <ResponsiveContainer width="100%" height={440}>
      <LineChart data={rows} margin={{ top: 8, right: 12, bottom: 0, left: 4 }}>
        <CartesianGrid stroke="#1f2430" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          scale="time"
          domain={["dataMin", "dataMax"]}
          tickFormatter={tickFmt(tf)}
          tick={{ fill: "#8b93a7", fontSize: 11 }}
          stroke="#2a2e39"
          minTickGap={48}
        />
        <YAxis
          orientation="right"
          domain={["auto", "auto"]}
          tickFormatter={(v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(0)}%`}
          tick={{ fill: "#8b93a7", fontSize: 11 }}
          stroke="#2a2e39"
          width={48}
        />
        <ReferenceLine y={0} stroke="#3a4150" strokeDasharray="3 3" />
        <Tooltip
          content={<CustomTooltip tf={tf} colors={colorMap} />}
          isAnimationActive={false}
        />
        {visible.map((s) => {
          const dim = highlight !== null && highlight !== s.symbol;
          const emphasized = highlight === s.symbol || s.isRef;
          return (
            <Line
              key={s.symbol}
              type="monotone"
              dataKey={s.symbol}
              stroke={s.color}
              strokeWidth={emphasized ? 2.6 : 1.4}
              strokeOpacity={dim ? 0.15 : 1}
              strokeDasharray={s.isRef ? "6 3" : undefined}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          );
        })}
      </LineChart>
    </ResponsiveContainer>
  );
}
