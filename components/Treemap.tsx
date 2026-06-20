"use client";
import { useMemo, useState } from "react";
import { hierarchy, treemap, treemapSquarify } from "d3-hierarchy";
import type { StockRow } from "@/lib/types";
import type { TimeframeKey } from "@/lib/timeframes";
import { returnColor } from "@/lib/color";
import { ETF_TO_SECTOR } from "@/lib/sectors";
import { fmtPct } from "@/lib/format";
import { isNearHigh, isNearLow, matchesFilter, type HighLowFilter } from "@/lib/compute";
import { useElementWidth } from "./useElementWidth";
import { useIsLight } from "./useIsLight";

interface NodeData {
  name: string;
  children?: NodeData[];
  row?: StockRow;
}

const HEIGHT = 640;

export default function Treemap({
  stocks,
  tf,
  filter,
  threshold,
  selected,
  onSelect,
  onIndustryClick,
  groupBy = "industry",
}: {
  stocks: StockRow[];
  tf: TimeframeKey;
  filter: HighLowFilter;
  threshold: number;
  selected: string | null;
  onSelect: (symbol: string | null) => void;
  onIndustryClick?: (industry: string) => void;
  groupBy?: "industry" | "sector" | "nativeSector";
}) {
  const { ref, width } = useElementWidth<HTMLDivElement>();
  const light = useIsLight();
  const [hover, setHover] = useState<{ row: StockRow; x: number; y: number } | null>(
    null,
  );

  const root = useMemo(() => {
    const byIndustry = new Map<string, StockRow[]>();
    const keyOf = (s: StockRow) =>
      groupBy === "nativeSector"
        ? s.sector || "Other" // the stock's own (e.g. local-market) sector name
        : groupBy === "sector"
          ? ETF_TO_SECTOR[s.etf]?.name ?? s.sector ?? "Other"
          : s.industry || "Other";
    for (const s of stocks) {
      const k = keyOf(s);
      if (!byIndustry.has(k)) byIndustry.set(k, []);
      byIndustry.get(k)!.push(s);
    }
    const data: NodeData = {
      name: "root",
      children: [...byIndustry.entries()]
        .map(([name, rows]) => ({
          name,
          children: rows.map((r) => ({ name: r.symbol, row: r })),
        }))
        .sort(
          (a, b) =>
            b.children.reduce((s, c) => s + (c.row!.marketCap || 1), 0) -
            a.children.reduce((s, c) => s + (c.row!.marketCap || 1), 0),
        ),
    };

    const h = hierarchy(data, (d) => d.children)
      .sum((d) => (d.row ? Math.max(d.row.marketCap || 0, 1) : 0))
      .sort((a, b) => (b.value ?? 0) - (a.value ?? 0));

    const w = width || 800;
    treemap<NodeData>()
      .size([w, HEIGHT])
      .paddingTop(18)
      .paddingInner(2)
      .paddingOuter(2)
      .round(true)
      .tile(treemapSquarify)(h);

    return h;
  }, [stocks, width, groupBy]);

  const leaves = root.leaves();
  const groups = root.descendants().filter((d) => d.depth === 1);
  const filterActive = filter !== "all";

  return (
    <div ref={ref} className="relative w-full" style={{ height: HEIGHT }}>
      {width > 0 && (
        <svg width={width} height={HEIGHT} className="block">
          {/* leaves */}
          {leaves.map((leaf) => {
            const row = leaf.data.row!;
            const x = (leaf as any).x0;
            const y = (leaf as any).y0;
            const w = (leaf as any).x1 - (leaf as any).x0;
            const h = (leaf as any).y1 - (leaf as any).y0;
            if (w < 1 || h < 1) return null;

            const matches = matchesFilter(row, filter, threshold);
            const dim = filterActive && !matches;
            const near =
              isNearHigh(row, threshold)
                ? "high"
                : isNearLow(row, threshold)
                  ? "low"
                  : null;
            const isSel = selected === row.symbol;
            const fill = returnColor(row.returns[tf], tf, light);

            const showTicker = w > 26 && h > 14;
            const showPct = w > 40 && h > 30;

            return (
              <g
                key={row.symbol}
                opacity={dim ? 0.18 : 1}
                onMouseEnter={(e) =>
                  setHover({
                    row,
                    x: x + w / 2,
                    y: y,
                  })
                }
                onMouseLeave={() => setHover(null)}
                onClick={() => onSelect(isSel ? null : row.symbol)}
                style={{ cursor: "pointer" }}
              >
                <rect
                  x={x}
                  y={y}
                  width={w}
                  height={h}
                  fill={fill}
                  stroke={isSel ? "#ffffff" : near === "high" ? "#22c55e" : near === "low" ? "#ef4444" : "var(--bg)"}
                  strokeWidth={isSel ? 2 : near ? 1.5 : 0.5}
                />
                {showTicker && (
                  <text
                    x={x + w / 2}
                    y={y + h / 2 - (showPct ? 5 : -1)}
                    textAnchor="middle"
                    fontSize={Math.min(13, Math.max(9, w / 5))}
                    fontWeight={700}
                    fill="#ffffff"
                    style={{ pointerEvents: "none" }}
                  >
                    {row.symbol}
                  </text>
                )}
                {showPct && (
                  <text
                    x={x + w / 2}
                    y={y + h / 2 + 11}
                    textAnchor="middle"
                    fontSize={10}
                    fill="rgba(255,255,255,0.85)"
                    style={{ pointerEvents: "none" }}
                  >
                    {fmtPct(row.returns[tf], 1)}
                  </text>
                )}
                {near && w > 18 && h > 18 && (
                  <text
                    x={x + w - 3}
                    y={y + 11}
                    textAnchor="end"
                    fontSize={9}
                    fill={near === "high" ? "#bbf7d0" : "#fecaca"}
                    style={{ pointerEvents: "none" }}
                  >
                    {near === "high" ? "▲" : "▼"}
                  </text>
                )}
              </g>
            );
          })}

          {/* industry group labels — rendered last so they sit on top of the tiles */}
          {groups.map((g) => {
            const gx = (g as any).x0;
            const gy = (g as any).y0;
            const gw = (g as any).x1 - (g as any).x0;
            if (gw < 40) return null;
            const clickable = !!onIndustryClick;
            return (
              <text
                key={`g-${g.data.name}`}
                x={gx + 5}
                y={gy + 12}
                fontSize={10}
                fontWeight={700}
                fill="#ffffff"
                stroke="rgba(0,0,0,0.55)"
                strokeWidth={2.4}
                paintOrder="stroke"
                onClick={clickable ? () => onIndustryClick!(g.data.name) : undefined}
                style={{
                  cursor: clickable ? "pointer" : "default",
                  textDecoration: clickable ? "underline" : "none",
                  textDecorationColor: "rgba(255,255,255,0.5)",
                }}
              >
                {truncate(g.data.name, Math.floor(gw / 6))}
              </text>
            );
          })}
        </svg>
      )}

      {hover && (
        <div
          className="pointer-events-none absolute z-10 w-56 -translate-x-1/2 translate-y-2 rounded-lg border border-[var(--border)] bg-[var(--bg)] p-3 text-xs shadow-xl"
          style={{
            left: Math.min(Math.max(hover.x, 110), (width || 0) - 110),
            top: hover.y,
          }}
        >
          <div className="flex items-center justify-between gap-2">
            <span className="font-mono text-sm font-bold">{hover.row.symbol}</span>
            <span
              className="font-semibold tabular-nums"
              style={{ color: trendText(hover.row.returns[tf]) }}
            >
              {fmtPct(hover.row.returns[tf])}
            </span>
          </div>
          <div className="mt-0.5 truncate text-[var(--text-3)]">{hover.row.name}</div>
          <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-[var(--text-2)]">
            <span className="text-[var(--text-3)]">From 52w high</span>
            <span className="text-right tabular-nums">{fmtPct(hover.row.pctFromHigh)}</span>
            <span className="text-[var(--text-3)]">From 52w low</span>
            <span className="text-right tabular-nums">+{hover.row.pctFromLow.toFixed(2)}%</span>
          </div>
        </div>
      )}
    </div>
  );
}

function truncate(s: string, max: number) {
  if (max <= 1) return "";
  return s.length > max ? s.slice(0, Math.max(1, max - 1)) + "…" : s;
}

function trendText(v: number | null) {
  if (v == null) return "var(--text-3)";
  return v > 0 ? "#22c55e" : v < 0 ? "#ef4444" : "var(--text-3)";
}
