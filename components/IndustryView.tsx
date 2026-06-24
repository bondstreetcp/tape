"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { usePolledFetch, fmtClock } from "@/lib/usePolledFetch";
import type { SectorMeta } from "@/lib/sectors";
import type { SectorSeries, StockRow, StockSeries, XY } from "@/lib/types";
import { TIMEFRAMES, parseTimeframe, type TimeframeKey } from "@/lib/timeframes";
import { usePersistedTimeframe } from "@/lib/useTimeframe";
import { buildComparison, xyToPoints, isNearHigh, isNearLow } from "@/lib/compute";
import { colorFor, ETF_LINE_COLOR } from "@/lib/palette";
import { trendColor } from "@/lib/color";
import { fmtPct, fmtDateTime } from "@/lib/format";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import TimeframeSelector from "./TimeframeSelector";
import UniverseSwitcher from "./UniverseSwitcher";
import IndustryExtras from "./IndustryExtras";
import type { SeriesDef } from "./MultiLineChart";

const MultiLineChart = dynamic(() => import("./MultiLineChart"), { ssr: false });

export default function IndustryView({
  meta,
  industry,
  stocks,
  seriesBySymbol,
  etfSeries,
  generatedAt,
  universe,
}: {
  meta: SectorMeta;
  industry: string;
  stocks: StockRow[];
  seriesBySymbol: Record<string, StockSeries>;
  etfSeries: SectorSeries | null;
  generatedAt: string;
  universe: string;
}) {
  const searchParams = useSearchParams();
  const [tf, setTf] = usePersistedTimeframe(searchParams.get("tf"), "3m");
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [highlight, setHighlight] = useState<string | null>(null);

  // 1D/1W plot the per-symbol intraday series, which only rebuilds after the close — so mid-session
  // it shows the prior day. Fetch live intraday on demand for those tenors and swap it in.
  const intradayTf = tf === "1d" || tf === "1w";
  const liveUrl = useMemo(
    () => (intradayTf ? `/api/intraday?symbols=${encodeURIComponent([meta.etf, ...stocks.map((s) => s.symbol)].join(","))}` : null),
    [intradayTf, stocks, meta.etf],
  );
  const { data: liveRaw, asOf, loading: liveLoading } = usePolledFetch(intradayTf, liveUrl);
  const live = useMemo(() => (liveRaw ? ((liveRaw.series || {}) as Record<string, XY[]>) : null), [liveRaw]);

  const now = useMemo(() => Date.parse(generatedAt) || Date.now(), [generatedAt]);

  // Stable color per stock, assigned in market-cap order (independent of timeframe).
  const colorBySymbol = useMemo(() => {
    const m: Record<string, string> = { [meta.etf]: ETF_LINE_COLOR };
    stocks.forEach((s, i) => (m[s.symbol] = colorFor(i)));
    return m;
  }, [stocks, meta.etf]);

  const { rows, endPct } = useMemo(() => {
    const useLive = intradayTf && !!live;
    const winNow = intradayTf ? Date.now() : now; // window live intraday against the real clock
    const liveOf = (sym: string, fallback: XY[]) => (useLive && live![sym]?.length ? xyToPoints(live![sym]) : xyToPoints(fallback));
    const items = [
      {
        symbol: meta.etf,
        intraday: liveOf(meta.etf, etfSeries?.intraday ? etfSeries.intraday.map((p) => [p.t, p.c] as XY) : []),
        daily: etfSeries?.daily ?? [],
      },
      ...stocks.map((s) => {
        const sr = seriesBySymbol[s.symbol];
        return {
          symbol: s.symbol,
          intraday: liveOf(s.symbol, sr?.intraday ?? []),
          daily: xyToPoints(sr?.daily ?? []),
        };
      }),
    ];
    const { rows, meta: cmeta } = buildComparison(items, tf, winNow);
    const endPct: Record<string, number | null> = {};
    for (const m of cmeta) endPct[m.symbol] = m.endPct;
    return { rows, endPct };
  }, [stocks, seriesBySymbol, etfSeries, meta.etf, tf, now, intradayTf, live]);

  // Chart series order (ETF first); legend sorted by performance with ETF pinned.
  const chartSeries: SeriesDef[] = useMemo(
    () => [
      { symbol: meta.etf, color: ETF_LINE_COLOR, isRef: true },
      ...stocks.map((s) => ({ symbol: s.symbol, color: colorBySymbol[s.symbol] })),
    ],
    [stocks, meta.etf, colorBySymbol],
  );

  const legend = useMemo(() => {
    const rowsArr = stocks.map((s) => ({
      symbol: s.symbol,
      name: s.name,
      end: endPct[s.symbol] ?? s.returns[tf] ?? null,
      near: isNearHigh(s, 2) ? "high" : isNearLow(s, 2) ? "low" : null,
      // live feed lagging this session: no live point, shown from the static close
      delayed: intradayTf && !!live && endPct[s.symbol] == null && (s.returns[tf] ?? null) != null,
    }));
    rowsArr.sort((a, b) => (b.end ?? -1e9) - (a.end ?? -1e9));
    return rowsArr;
  }, [stocks, endPct, tf, intradayTf, live]);
  const delayedCount = useMemo(() => legend.filter((r) => r.delayed).length, [legend]);

  const toggle = (sym: string) =>
    setHidden((prev) => {
      const next = new Set(prev);
      next.has(sym) ? next.delete(sym) : next.add(sym);
      return next;
    });

  const allSymbols = [meta.etf, ...stocks.map((s) => s.symbol)];

  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      {/* breadcrumb + header */}
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link
            href={`/u/${universe}/sector/${meta.etf.toLowerCase()}?tf=${tf}`}
            className="mb-1.5 inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm font-medium text-[var(--text-2)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
          >
            ← Back to {meta.name}
          </Link>
          <div className="flex items-center gap-2 text-sm text-[var(--text-3)]">
            <Link href={`/u/${universe}`} className="hover:text-[var(--text)]">
              {UNIVERSE_BY_ID[universe]?.name ?? "Sectors"}
            </Link>
            <span>/</span>
            <Link
              href={`/u/${universe}/sector/${meta.etf.toLowerCase()}?tf=${tf}`}
              className="hover:text-[var(--text)]"
            >
              {meta.etf} {meta.name}
            </Link>
          </div>
          <h1 className="mt-1 text-2xl font-bold">{industry}</h1>
          <p className="mt-1 text-xs text-[var(--text-3)]">
            {stocks.length} constituents · each line rebased to % change · dashed
            white = {meta.etf} · as of {fmtDateTime(generatedAt)}
            {intradayTf && (live ? (
              <span title="Auto-refreshes ~every minute · 15-minute bars, edge-cached ~2 min" className="text-[#22c55e]">
                {" "}· live{asOf ? ` · updated ${fmtClock(asOf)}` : ""}{liveLoading ? " ⟳" : ""}
                {delayedCount > 0 && <span className="text-[#f59e0b]" title="These names' live feed is lagging this session — shown from their last close"> · {delayedCount} delayed</span>}
              </span>
            ) : liveLoading ? <span className="text-[var(--text-4)]"> · fetching live intraday…</span> : null)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <UniverseSwitcher current={universe} etf={meta.etf} />
          <TimeframeSelector value={tf} onChange={setTf} />
        </div>
      </div>

      <div className="flex flex-col gap-4 lg:flex-row">
        {/* chart */}
        <section className="min-w-0 flex-1 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <MultiLineChart
            rows={rows}
            series={chartSeries}
            tf={tf}
            hidden={hidden}
            highlight={highlight}
            showEndLabels
          />
        </section>

        {/* interactive legend */}
        <aside className="w-full shrink-0 lg:w-72">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-xs font-medium text-[var(--text-2)]">
              {TIMEFRAMES.find((t) => t.key === tf)?.label} performance
            </span>
            <div className="flex gap-1 text-xs">
              <button
                onClick={() => setHidden(new Set())}
                className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--text-3)] hover:text-[var(--text)]"
              >
                All
              </button>
              <button
                onClick={() => setHidden(new Set(allSymbols))}
                className="rounded border border-[var(--border)] px-2 py-0.5 text-[var(--text-3)] hover:text-[var(--text)]"
              >
                None
              </button>
            </div>
          </div>

          <div className="max-h-[440px] overflow-y-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
            {/* ETF reference row */}
            <LegendRow
              symbol={meta.etf}
              name={`${meta.name} (sector ETF)`}
              color={ETF_LINE_COLOR}
              end={endPct[meta.etf] ?? null}
              near={null}
              hidden={hidden.has(meta.etf)}
              onToggle={() => toggle(meta.etf)}
              onHover={() => setHighlight(meta.etf)}
              onLeave={() => setHighlight(null)}
              isRef
            />
            {legend.map((r) => (
              <LegendRow
                key={r.symbol}
                symbol={r.symbol}
                name={r.name}
                color={colorBySymbol[r.symbol]}
                end={r.end}
                delayed={r.delayed}
                near={r.near as "high" | "low" | null}
                hidden={hidden.has(r.symbol)}
                onToggle={() => toggle(r.symbol)}
                onHover={() => setHighlight(r.symbol)}
                onLeave={() => setHighlight(null)}
                href={`/u/${universe}/stock/${encodeURIComponent(r.symbol)}`}
              />
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--text-3)]">
            Click a row to hide/show its line · hover to highlight.
          </p>
        </aside>
      </div>

      <div className="mt-5">
        <IndustryExtras stocks={stocks} tf={tf} universe={universe} label={industry} />
      </div>
    </main>
  );
}

function LegendRow({
  symbol,
  name,
  color,
  end,
  delayed,
  near,
  hidden,
  onToggle,
  onHover,
  onLeave,
  isRef,
  href,
}: {
  symbol: string;
  name: string;
  color: string;
  end: number | null;
  delayed?: boolean;
  near: "high" | "low" | null;
  hidden: boolean;
  onToggle: () => void;
  onHover: () => void;
  onLeave: () => void;
  isRef?: boolean;
  href?: string;
}) {
  return (
    <div
      onMouseEnter={onHover}
      onMouseLeave={onLeave}
      className={
        "flex items-center gap-2 border-b border-[var(--divider)] px-3 py-2 transition-colors hover:bg-[var(--surface-hover)] " +
        (hidden ? "opacity-40 " : "") +
        (isRef ? "bg-[var(--bg)]" : "")
      }
    >
      <button
        onClick={onToggle}
        className="flex min-w-0 flex-1 items-center gap-2 text-left"
      >
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded border"
          style={{
            background: hidden ? "transparent" : color,
            borderColor: color,
            borderStyle: isRef ? "dashed" : "solid",
          }}
          title={hidden ? "Show line" : "Hide line"}
        >
          {!hidden && (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--bg)" strokeWidth="4">
              <path d="M5 12l5 5L20 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </span>
        <span className="w-12 shrink-0 font-mono text-sm font-semibold">{symbol}</span>
        <span className="min-w-0 flex-1 truncate text-xs text-[var(--text-3)]">{name}</span>
        {near && (
          <span className={near === "high" ? "text-[#22c55e]" : "text-[#ef4444]"}>
            {near === "high" ? "▲" : "▼"}
          </span>
        )}
      </button>
      <span className="flex w-16 shrink-0 items-center justify-end gap-0.5 text-right text-sm tabular-nums" style={{ color: trendColor(end) }}>
        {delayed && <span className="text-[10px] text-[#f59e0b]" title="Live feed lagging this session — last close">⏱</span>}
        {fmtPct(end, 1)}
      </span>
      {href && (
        <Link
          href={href}
          className="shrink-0 text-[var(--text-3)] hover:text-[#60a5fa]"
          title="Open full chart + indicators"
        >
          ↗
        </Link>
      )}
    </div>
  );
}
