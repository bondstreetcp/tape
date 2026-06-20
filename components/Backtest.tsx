"use client";
import { useEffect, useMemo, useState } from "react";
import { runStrategy, strategyLabel, type BacktestMatrix, type BacktestResult, type StrategyKey } from "@/lib/backtest";

const STRATS: StrategyKey[] = ["momentum", "trend", "lowvol", "equal"];
const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`;

export default function Backtest({ universe }: { universe: string }) {
  const [matrix, setMatrix] = useState<BacktestMatrix | "loading" | "err" | null>("loading");
  const [strategy, setStrategy] = useState<StrategyKey>("momentum");
  const [topN, setTopN] = useState(20);
  const [lookback, setLookback] = useState(6);

  useEffect(() => {
    let a = true;
    setMatrix("loading");
    fetch(`/api/backtest-data/${encodeURIComponent(universe)}`)
      .then((r) => r.json())
      .then((d) => a && setMatrix(d.matrix || "err"))
      .catch(() => a && setMatrix("err"));
    return () => { a = false; };
  }, [universe]);

  const result = useMemo<BacktestResult | null>(
    () => (matrix && matrix !== "loading" && matrix !== "err" ? runStrategy(matrix, { strategy, topN, lookback }) : null),
    [matrix, strategy, topN, lookback],
  );

  if (matrix === "loading") return <Box>Loading price history…</Box>;
  if (matrix === "err" || !matrix) return <Box>Backtest data isn’t available for this universe yet.</Box>;
  const usesParams = strategy === "momentum" || strategy === "lowvol";

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-[#2a2e39] bg-[#131722] p-0.5">
          {STRATS.map((s) => (
            <button
              key={s}
              onClick={() => setStrategy(s)}
              title={strategyLabel(s)}
              className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (strategy === s ? "bg-[#2563eb] text-white" : "text-[#8b93a7] hover:text-[#e6e9f0]")}
            >
              {strategyLabel(s).split(" (")[0]}
            </button>
          ))}
        </div>
        {usesParams && <Select label="Hold" value={topN} onChange={setTopN} opts={[10, 20, 30, 50]} suffix=" names" />}
        {usesParams && <Select label="Lookback" value={lookback} onChange={setLookback} opts={[3, 6, 12]} suffix=" mo" />}
      </div>

      {!result ? (
        <Box>Not enough price history to backtest.</Box>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Metric label="Strategy total" value={fmtPct(result.metrics.stratTotal)} color={result.metrics.stratTotal >= result.metrics.benchTotal ? "#22c55e" : "#e6e9f0"} />
            <Metric label="Benchmark total" value={fmtPct(result.metrics.benchTotal)} />
            <Metric label="CAGR" value={fmtPct(result.metrics.stratCagr)} />
            <Metric label="Max drawdown" value={fmtPct(result.metrics.maxDD)} color="#ef4444" />
            <Metric label="Sharpe" value={result.metrics.sharpe.toFixed(2)} />
          </div>

          <EquityChart result={result} />

          {strategy !== "equal" && result.holdingsLast.length > 0 && (
            <div className="text-xs text-[#8b93a7]">
              <span className="font-medium text-[#aab2c5]">Current holdings:</span> {result.holdingsLast.slice(0, 25).join(", ")}
              {result.holdingsLast.length > 25 ? "…" : ""}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-[#5b6478]">
            Monthly rebalance, equal-weight, drawn from the top {matrix.symbols.length} names by market cap; benchmark is the cap-weighted
            group. {result.metrics.months} months. Price signals only — no fundamental look-ahead. Uses <em>today’s</em> constituents, so
            results carry <span className="text-[#8b93a7]">survivorship bias</span> (delisted names are absent) — treat as indicative, not a track record.
          </p>
        </>
      )}
    </div>
  );
}

function EquityChart({ result }: { result: BacktestResult }) {
  const W = 1000, H = 320, ML = 48, MR = 14, MT = 16, MB = 22;
  const { dates, strategy: strat, benchmark: bench } = result;
  const n = dates.length;
  const all = [...strat, ...bench];
  let yMin = Math.min(...all), yMax = Math.max(...all);
  const pad = (yMax - yMin) * 0.05 || 1;
  yMin -= pad; yMax += pad;
  const x = (i: number) => ML + (i / Math.max(1, n - 1)) * (W - ML - MR);
  const y = (v: number) => MT + (1 - (v - yMin) / (yMax - yMin || 1)) * (H - MT - MB);
  const path = (arr: number[]) => arr.map((v, i) => `${i ? "L" : "M"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join("");
  const yearTicks: { x: number; label: number }[] = [];
  let lastYr = 0;
  dates.forEach((t, i) => {
    const yr = new Date(t).getUTCFullYear();
    if (yr !== lastYr) { lastYr = yr; yearTicks.push({ x: x(i), label: yr }); }
  });
  const yTicks = [yMin, (yMin + yMax) / 2, yMax].map((v) => ({ y: y(v), label: Math.round(v).toString() }));
  return (
    <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-3">
      <div className="mb-1 flex items-center gap-4 text-[11px] text-[#8b93a7]">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: "#60a5fa" }} /> Strategy</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: "#5b6478" }} /> Benchmark (cap-weighted)</span>
        <span className="text-[#5b6478]">· growth of 100</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={ML} x2={W - MR} y1={t.y} y2={t.y} stroke="#1a1f2b" />
            <text x={ML - 6} y={t.y + 3} textAnchor="end" fontSize={10} fill="#5b6478">{t.label}</text>
          </g>
        ))}
        {yearTicks.map((t, i) => (
          <text key={i} x={t.x} y={H - 7} textAnchor="middle" fontSize={10} fill="#5b6478">{t.label}</text>
        ))}
        <path d={path(bench)} fill="none" stroke="#5b6478" strokeWidth={1.4} />
        <path d={path(strat)} fill="none" stroke="#60a5fa" strokeWidth={1.9} />
      </svg>
    </div>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-8 text-center text-sm text-[#8b93a7]">{children}</div>;
}
function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[#2a2e39] bg-[#131722] px-3 py-2">
      <div className="text-[10px] text-[#8b93a7]">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
function Select({ label, value, onChange, opts, suffix }: { label: string; value: number; onChange: (v: number) => void; opts: number[]; suffix?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-[#8b93a7]">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-lg border border-[#2a2e39] bg-[#131722] px-2 py-1.5 text-xs text-[#e6e9f0] outline-none focus:border-[#3a4256]"
      >
        {opts.map((o) => (
          <option key={o} value={o}>{o}{suffix}</option>
        ))}
      </select>
    </label>
  );
}
