"use client";
import { useEffect, useMemo, useState } from "react";
import { runStrategy, strategyLabel, type BacktestMatrix, type BacktestResult, type StrategyKey } from "@/lib/backtest";
import { combinedScreenSymbols, SCREEN_LABEL, SCREEN_SHORT, SCREEN_ORDER, type ScreenKey } from "@/lib/screens";
import type { StockRow } from "@/lib/types";
import StrategyTip from "./StrategyTip";

const STRATS: StrategyKey[] = ["momentum", "trend", "lowvol", "equal"];
const fmtPct = (v: number) => `${v >= 0 ? "+" : ""}${(v * 100).toFixed(0)}%`;

export default function Backtest({ universe, stocks = [] }: { universe: string; stocks?: StockRow[] }) {
  const [matrix, setMatrix] = useState<BacktestMatrix | "loading" | "err" | null>("loading");
  const [strategy, setStrategy] = useState<StrategyKey>("momentum");
  const [screens, setScreens] = useState<ScreenKey[]>([]);
  const [topN, setTopN] = useState(20);
  const [lookback, setLookback] = useState(6);
  const [pioMin, setPioMin] = useState(7);
  const screensOn = screens.length > 0;
  const toggleScreen = (k: ScreenKey) => setScreens((cur) => (cur.includes(k) ? cur.filter((x) => x !== k) : [...cur, k]));

  useEffect(() => {
    let a = true;
    setMatrix("loading");
    fetch(`/api/backtest-data/${encodeURIComponent(universe)}`)
      .then((r) => r.json())
      .then((d) => a && setMatrix(d.matrix || "err"))
      .catch(() => a && setMatrix("err"));
    return () => { a = false; };
  }, [universe]);

  // The backtest matrix only covers the names we have monthly price history for (the universe's
  // largest). Restrict the screen universe to those, so a screen that would otherwise pick smaller
  // names (Magic Formula, Net-Net…) holds backtestable names instead of being silently dropped to
  // ~nothing (which made some strategies show a flat 0%).
  const backtestable = useMemo(() => {
    if (!matrix || matrix === "loading" || matrix === "err") return stocks;
    const set = new Set(matrix.symbols);
    return stocks.filter((s) => set.has(s.symbol));
  }, [matrix, stocks]);
  // For a factor screen (or a stack of them) hold the passing names — today's fundamentals across all
  // history → look-ahead, flagged below. Stacking ANDs the screens (intersection).
  const holdings = useMemo(() => (screens.length ? combinedScreenSymbols(screens, backtestable, { topN, pioMin }) : undefined), [screens, backtestable, topN, pioMin]);

  const result = useMemo<BacktestResult | null>(() => {
    if (!matrix || matrix === "loading" || matrix === "err") return null;
    return screensOn
      ? runStrategy(matrix, { strategy: "screen", holdings })
      : runStrategy(matrix, { strategy, topN, lookback });
  }, [matrix, strategy, screensOn, holdings, topN, lookback]);

  if (matrix === "loading") return <Box>Loading price history…</Box>;
  if (matrix === "err" || !matrix) return <Box>Backtest data isn’t available for this universe yet.</Box>;
  const usesParams = !screensOn && (strategy === "momentum" || strategy === "lowvol");
  const nHold = holdings?.length ?? 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex flex-wrap rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
          {STRATS.map((s) => (
            <button
              key={s}
              onClick={() => { setStrategy(s); setScreens([]); }}
              title={strategyLabel(s)}
              className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (!screensOn && strategy === s ? "bg-[#2563eb] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
            >
              {strategyLabel(s).split(" (")[0]}
            </button>
          ))}
        </div>
        <div className="inline-flex flex-wrap rounded-lg border border-[#a855f7]/40 bg-[var(--surface)] p-0.5">
          {SCREEN_ORDER.map((s) => (
            <button
              key={s}
              onClick={() => toggleScreen(s)}
              title={`${SCREEN_LABEL[s]} — toggle; stack screens to hold only names passing all of them`}
              className={"rounded-md px-2.5 py-1 text-xs font-medium transition-colors " + (screens.includes(s) ? "bg-[#a855f7] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
            >
              {SCREEN_SHORT[s]}
            </button>
          ))}
        </div>
        <StrategyTip />
        {usesParams && <Select label="Hold" value={topN} onChange={setTopN} opts={[10, 20, 30, 50]} suffix=" names" />}
        {usesParams && <Select label="Lookback" value={lookback} onChange={setLookback} opts={[3, 6, 12]} suffix=" mo" />}
        {screensOn && (screens.length >= 2 || screens.some((s) => s !== "netnet" && s !== "piotroski")) && <Select label="Top" value={topN} onChange={setTopN} opts={[20, 30, 50, 75]} />}
        {screens.includes("piotroski") && <Select label="F ≥" value={pioMin} onChange={setPioMin} opts={[5, 6, 7, 8, 9]} />}
      </div>

      {screensOn && (
        <div className="text-xs text-[var(--text-3)]">
          Holding the <span className="font-semibold text-[#d8b4fe]">{screens.map((s) => SCREEN_SHORT[s]).join(" ∩ ")}</span> basket — {nHold} name{nHold === 1 ? "" : "s"}, equal-weight{screens.length > 1 ? " (passing all)" : ""}.
          {nHold === 0 && <span className="text-[var(--text-4)]"> Nothing passes {screens.length > 1 ? "all selected screens" : "in this universe"}{screens.includes("netnet") ? " (net-nets are rare outside small caps — try Broad 1500 / Russell 3000)" : ""}.</span>}
        </div>
      )}

      {!result ? (
        <Box>{screensOn && nHold === 0 ? "No names pass these screens in the current universe." : "Not enough price history to backtest."}</Box>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            <Metric label="Strategy total" value={fmtPct(result.metrics.stratTotal)} color={result.metrics.stratTotal >= result.metrics.benchTotal ? "#22c55e" : "var(--text)"} />
            <Metric label="Benchmark total" value={fmtPct(result.metrics.benchTotal)} />
            <Metric label="CAGR" value={fmtPct(result.metrics.stratCagr)} />
            <Metric label="Max drawdown" value={fmtPct(result.metrics.maxDD)} color="#ef4444" />
            <Metric label="Sharpe" value={result.metrics.sharpe.toFixed(2)} />
          </div>

          <EquityChart result={result} />

          {(screensOn || strategy !== "equal") && result.holdingsLast.length > 0 && (
            <div className="text-xs leading-relaxed text-[var(--text-3)]">
              <span className="font-medium text-[var(--text-2)]">Holdings ({result.holdingsLast.length}):</span> {result.holdingsLast.join(", ")}
            </div>
          )}

          <p className="text-[11px] leading-relaxed text-[var(--text-4)]">
            Monthly rebalance, equal-weight; benchmark is the cap-weighted group ({result.metrics.months} months).{" "}
            {screensOn ? (
              <span className="text-[#fca5a5]">This factor screen applies <em>today’s</em> fundamentals across all of history (look-ahead bias) — it shows how today’s basket would have traded, not a point-in-time strategy.</span>
            ) : (
              <>Price signals only — no fundamental look-ahead.</>
            )}{" "}
            Uses <em>today’s</em> constituents, so results also carry <span className="text-[var(--text-3)]">survivorship bias</span> — treat as indicative, not a track record.
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
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-3">
      <div className="mb-1 flex items-center gap-4 text-[11px] text-[var(--text-3)]">
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: "#60a5fa" }} /> Strategy</span>
        <span className="flex items-center gap-1"><span className="inline-block h-0.5 w-4" style={{ background: "var(--text-4)" }} /> Benchmark (cap-weighted)</span>
        <span className="text-[var(--text-4)]">· growth of 100</span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: "auto" }}>
        {yTicks.map((t, i) => (
          <g key={i}>
            <line x1={ML} x2={W - MR} y1={t.y} y2={t.y} stroke="var(--surface-hover)" />
            <text x={ML - 6} y={t.y + 3} textAnchor="end" fontSize={10} fill="var(--text-4)">{t.label}</text>
          </g>
        ))}
        {yearTicks.map((t, i) => (
          <text key={i} x={t.x} y={H - 7} textAnchor="middle" fontSize={10} fill="var(--text-4)">{t.label}</text>
        ))}
        <path d={path(bench)} fill="none" stroke="var(--text-4)" strokeWidth={1.4} />
        <path d={path(strat)} fill="none" stroke="#60a5fa" strokeWidth={1.9} />
      </svg>
    </div>
  );
}

function Box({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-8 text-center text-sm text-[var(--text-3)]">{children}</div>;
}
function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-3 py-2">
      <div className="text-[10px] text-[var(--text-3)]">{label}</div>
      <div className="mt-0.5 text-lg font-semibold tabular-nums" style={color ? { color } : undefined}>{value}</div>
    </div>
  );
}
function Select({ label, value, onChange, opts, suffix }: { label: string; value: number; onChange: (v: number) => void; opts: number[]; suffix?: string }) {
  return (
    <label className="flex items-center gap-1.5 text-xs text-[var(--text-3)]">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rounded-lg border border-[var(--border)] bg-[var(--surface)] px-2 py-1.5 text-xs text-[var(--text)] outline-none focus:border-[var(--border-strong)]"
      >
        {opts.map((o) => (
          <option key={o} value={o}>{o}{suffix}</option>
        ))}
      </select>
    </label>
  );
}
