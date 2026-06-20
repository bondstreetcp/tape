"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SeriesPoint } from "@/lib/types";
import type { TimeframeKey } from "@/lib/timeframes";
import { buildComparison } from "@/lib/compute";
import { ECON_PREFIX, prettySym } from "@/lib/econOverlays";
import MultiLineChart from "./MultiLineChart";

const COLORS = ["#60a5fa", "#f472b6", "#fbbf24", "#4ade80", "#c084fc", "#fb923c", "#fb7185", "#22d3ee", "#a3e635", "#e879f9"];

type Bars = { daily: SeriesPoint[]; intraday: SeriesPoint[] };

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 5) return NaN;
  let sa = 0, sb = 0;
  for (let i = 0; i < n; i++) { sa += a[i]; sb += b[i]; }
  const ma = sa / n, mb = sb / n;
  let cov = 0, va = 0, vb = 0;
  for (let i = 0; i < n; i++) { const da = a[i] - ma, db = b[i] - mb; cov += da * db; va += da * da; vb += db * db; }
  return va && vb ? cov / Math.sqrt(va * vb) : NaN;
}

// Pairwise return correlation across the compared series, over their common dates.
function computeCorr(items: { symbol: string; daily: SeriesPoint[] }[]) {
  if (items.length < 2) return null;
  // Align by calendar day — the main series (snapshot) and fetched compares come
  // from different sources, so their exact epoch timestamps don't always match.
  const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
  const maps = items.map((it) => new Map(it.daily.map((p) => [dayKey(p.t), p.c])));
  let common = [...maps[0].keys()];
  for (let i = 1; i < maps.length; i++) common = common.filter((d) => maps[i].has(d));
  common.sort();
  if (common.length < 11) return null;
  const rets = maps.map((m) => {
    const r: number[] = [];
    for (let i = 1; i < common.length; i++) { const p = m.get(common[i - 1])!, c = m.get(common[i])!; r.push(p ? c / p - 1 : 0); }
    return r;
  });
  const n = items.length;
  const grid = Array.from({ length: n }, () => new Array(n).fill(1));
  for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) { const c = pearson(rets[i], rets[j]); grid[i][j] = grid[j][i] = c; }
  return { labels: items.map((it) => prettySym(it.symbol)), grid, days: common.length };
}

const corrColor = (v: number) =>
  Number.isNaN(v) ? "var(--surface-2)" : `rgba(${v >= 0 ? "34,197,94" : "239,68,68"},${Math.min(0.85, Math.abs(v) * 0.8 + 0.08)})`;

export default function CompareChart({
  mainSymbol,
  mainDaily,
  mainIntraday,
  compareSymbols,
  tf,
  now,
  inverted,
}: {
  mainSymbol: string;
  mainDaily: SeriesPoint[];
  mainIntraday: SeriesPoint[];
  compareSymbols: string[];
  tf: TimeframeKey;
  now: number;
  inverted?: Set<string>;
}) {
  const [fetched, setFetched] = useState<Record<string, Bars | null>>({});
  // Track requested symbols in a ref (not state) so this effect depends only on
  // compareSymbols — depending on `fetched` made each re-run's cleanup cancel the
  // in-flight fetch, so comparisons never plotted. No "alive"/"mounted" flag: in
  // dev StrictMode the mount→unmount→remount would leave it false forever; React
  // 18+ no-ops setState after unmount anyway.
  const requested = useRef<Set<string>>(new Set());

  useEffect(() => {
    for (const sym of compareSymbols) {
      if (requested.current.has(sym)) continue;
      requested.current.add(sym);
      const url = sym.startsWith(ECON_PREFIX)
        ? `/api/econ-series/${encodeURIComponent(sym.slice(ECON_PREFIX.length))}`
        : `/api/ohlc/${encodeURIComponent(sym)}?years=5`; // full history so it matches any selected timeframe
      fetch(url)
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          const toPts = (a: any[]): SeriesPoint[] => (a || []).map((b: any) => ({ t: b.t, c: b.c }));
          setFetched((p) => ({ ...p, [sym]: d ? { daily: toPts(d.daily), intraday: toPts(d.intraday) } : null }));
        })
        .catch(() => {
          requested.current.delete(sym); // allow a retry on failure
          setFetched((p) => ({ ...p, [sym]: null }));
        });
    }
  }, [compareSymbols]);

  const { rows, series, corr } = useMemo(() => {
    const items = [{ symbol: mainSymbol, daily: mainDaily, intraday: mainIntraday }];
    for (const sym of compareSymbols) {
      const f = fetched[sym];
      if (f) items.push({ symbol: sym, daily: f.daily, intraday: f.intraday });
    }
    const { rows } = buildComparison(items, tf, now);
    // Inverted series: flip the rebased % so an inverse relationship lines up
    // visually (e.g. the 10-yr yield vs REITs). Correlation below stays un-flipped.
    if (inverted && inverted.size) {
      for (const r of rows) for (const sym of inverted) if (typeof r[sym] === "number") r[sym] = -r[sym];
    }
    const series = items.map((it, i) => ({ symbol: it.symbol, color: COLORS[i % COLORS.length], label: prettySym(it.symbol) + (inverted?.has(it.symbol) ? " (inv)" : ""), secondary: !!inverted?.has(it.symbol) }));
    const corr = computeCorr(items);
    return { rows, series, corr };
  }, [mainSymbol, mainDaily, mainIntraday, compareSymbols, fetched, tf, now, inverted]);

  const loading = compareSymbols.some((s) => fetched[s] === undefined || fetched[s] === null);

  return (
    <div>
      <MultiLineChart rows={rows} series={series} tf={tf} hidden={new Set()} highlight={null} showEndLabels />
      <p className="mt-1 text-center text-[11px] text-[var(--text-4)]">
        Rebased to % change over the window — compare relative performance.
        {loading && compareSymbols.length > 0 && " · loading…"}
      </p>
      {corr && corr.labels.length >= 2 && (
        <div className="mx-auto mt-3 w-fit">
          <div className="mb-1 text-center text-[11px] text-[var(--text-4)]">Daily-return correlation · {corr.days}-day common window</div>
          <table className="text-xs">
            <thead>
              <tr>
                <th className="px-1.5 py-0.5" />
                {corr.labels.map((l, j) => (
                  <th key={j} className="max-w-[68px] truncate px-2 py-0.5 text-center font-mono text-[var(--text-3)]" title={l}>{l}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {corr.grid.map((rw, i) => (
                <tr key={i}>
                  <td className="max-w-[88px] truncate px-1.5 py-0.5 text-right font-mono text-[var(--text-3)]" title={corr.labels[i]}>{corr.labels[i]}</td>
                  {rw.map((v, j) => (
                    <td key={j} className="px-2.5 py-0.5 text-center font-mono tabular-nums text-white [text-shadow:0_1px_1px_rgba(0,0,0,0.45)]" style={{ background: corrColor(v) }}>
                      {Number.isNaN(v) ? "—" : v.toFixed(2)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
