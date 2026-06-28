"use client";
import { useEffect, useState } from "react";

interface Bar { t: number; c: number }
const RANGES = [["1M", 30], ["6M", 182], ["1Y", 365], ["5Y", 1830]] as const;

/** Headline index price chart (for international universe home pages), fed by the
 *  shared /api/ohlc endpoint (daily closes via Yahoo). */
export default function IndexChart({ symbol, name }: { symbol: string; name: string }) {
  const [daily, setDaily] = useState<Bar[] | null>(null);
  const [err, setErr] = useState(false);
  const [range, setRange] = useState(365);

  useEffect(() => {
    let a = true;
    setDaily(null); setErr(false);
    fetch(`/api/ohlc/${encodeURIComponent(symbol)}?years=5`)
      .then((r) => r.json())
      .then((d) => { if (a) (d.daily?.length ? setDaily(d.daily) : setErr(true)); })
      .catch(() => a && setErr(true));
    return () => { a = false; };
  }, [symbol]);

  const cutoff = Date.now() - range * 86_400_000;
  const series = (daily || []).filter((b) => b.t >= cutoff);
  const first = series[0]?.c, last = series[series.length - 1]?.c;
  const chg = first != null && last != null && first !== 0 ? (last / first - 1) * 100 : null;
  const up = (chg ?? 0) >= 0;
  const label = RANGES.find(([, d]) => d === range)?.[0] ?? "";
  const fmtVal = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

  return (
    <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-bold text-[var(--text)]">{name}</h2>
            <span className="font-mono text-[11px] text-[var(--text-4)]">{symbol}</span>
          </div>
          {last != null && (
            <div className="mt-0.5 flex flex-wrap items-baseline gap-2">
              <span className="font-mono text-xl font-semibold tabular-nums text-[var(--text)]">{fmtVal(last)}</span>
              {chg != null && (
                <span className="text-sm font-medium tabular-nums" style={{ color: up ? "#22c55e" : "#ef4444" }}>
                  {up ? "▲" : "▼"} {up ? "+" : ""}{chg.toFixed(2)}% <span className="text-[var(--text-4)]">· {label}</span>
                </span>
              )}
            </div>
          )}
        </div>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5">
          {RANGES.map(([lbl, d]) => (
            <button key={lbl} onClick={() => setRange(d)} className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (range === d ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}>{lbl}</button>
          ))}
        </div>
      </div>
      {err ? (
        <div className="py-12 text-center text-sm text-[var(--text-3)]">No chart data for this index.</div>
      ) : !daily ? (
        <div className="py-12 text-center text-sm text-[var(--text-3)]">Loading chart…</div>
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
  const fmtD = (t: number) => new Date(t).toLocaleDateString(undefined, { month: "short", year: "2-digit" });
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
