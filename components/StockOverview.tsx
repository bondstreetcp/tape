"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import type { SeriesPoint, StockRow } from "@/lib/types";
import { TIMEFRAMES } from "@/lib/timeframes";
import { usePersistedTimeframe } from "@/lib/useTimeframe";
import { sliceSeries, seriesChangePct } from "@/lib/compute";
import { trendColor } from "@/lib/color";
import { fmtPct, fmtMoney } from "@/lib/format";
import { ECON_OVERLAYS, econSym, prettySym, ECON_PREFIX } from "@/lib/econOverlays";
import TimeframeSelector from "./TimeframeSelector";
import NewsFeed from "./NewsFeed";
import BriefingTickerNews from "./BriefingTickerNews";
import StockExtras, { BorrowPanel } from "./StockExtras";
import AskAI from "./AskAI";
import SeasonalityPanel from "./SeasonalityPanel";
import ExplainMove from "./ExplainMove";
import KeyStatsStrip from "./KeyStatsStrip";
import type { CompanyStats } from "@/lib/companyStats";

const IndicatorChart = dynamic(() => import("./IndicatorChart"), { ssr: false });
const CandleChart = dynamic(() => import("./CandleChart"), { ssr: false });
const CompareChart = dynamic(() => import("./CompareChart"), { ssr: false });

// One-click cross-asset overlays (rebased to % change). Symbols are Yahoo's.
const COMPARE_PRESETS: { label: string; sym: string }[] = [
  { label: "Crude", sym: "CL=F" },
  { label: "Gold", sym: "GC=F" },
  { label: "10Y", sym: "^TNX" },
  { label: "Dollar", sym: "UUP" },
  { label: "S&P", sym: "^GSPC" },
  { label: "VIX", sym: "^VIX" },
  { label: "BTC", sym: "BTC-USD" },
];

const CMP_COLORS = ["#f472b6", "#fbbf24", "#4ade80", "#c084fc", "#fb923c", "#fb7185", "#22d3ee", "#a3e635", "#e879f9"];
const MAX_COMPARE = 8;

/** Overview tab of the unified ticker page: price chart (+ technicals, candles,
 *  cross-asset compare), 52-week range, timeframe returns, AskAI, earnings/analyst
 *  reactions, and news. */
export default function StockOverview({
  row,
  daily,
  intraday,
  generatedAt,
  currency = "USD",
  stats = null,
}: {
  row: StockRow;
  daily: SeriesPoint[];
  intraday: SeriesPoint[];
  generatedAt: string;
  currency?: string;
  stats?: CompanyStats | null;
}) {
  const [tf, setTf] = usePersistedTimeframe(null, "1y");
  const [chartMode, setChartMode] = useState<"line" | "candles">("line");
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);
  const [compareInput, setCompareInput] = useState("");
  const [inverted, setInverted] = useState<Set<string>>(new Set());
  const now = useMemo(() => Date.parse(generatedAt) || Date.now(), [generatedAt]);

  const addCompare = (raw?: string) => {
    const input = (raw ?? compareInput).trim();
    // Econ overlays are trusted pseudo-symbols ("ECON:housing") — don't uppercase
    // or strip the colon; everything else is a Yahoo ticker.
    const s = input.startsWith(ECON_PREFIX) ? input : input.toUpperCase().replace(/[^A-Z0-9.=^-]/g, "");
    if (s && s !== row.symbol && !compareSymbols.includes(s) && compareSymbols.length < MAX_COMPARE) {
      setCompareSymbols((p) => [...p, s]);
    }
    setCompareInput("");
  };
  const removeCompare = (s: string) => {
    setCompareSymbols((p) => p.filter((x) => x !== s));
    setInverted((p) => { const n = new Set(p); n.delete(s); return n; });
  };
  const toggleInvert = (s: string) => setInverted((p) => { const n = new Set(p); n.has(s) ? n.delete(s) : n.add(s); return n; });
  const comparing = compareSymbols.length > 0;

  const windowChange = useMemo(() => {
    const pts = sliceSeries(intraday, daily, tf, now);
    return seriesChangePct(pts);
  }, [intraday, daily, tf, now]);

  const span = row.fiftyTwoWeekHigh - row.fiftyTwoWeekLow;
  const pos = span > 0 ? Math.min(100, Math.max(0, ((row.price - row.fiftyTwoWeekLow) / span) * 100)) : 50;

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <span className="text-lg font-semibold tabular-nums" style={{ color: trendColor(row.returns[tf] ?? windowChange) }}>
          {fmtPct(row.returns[tf] ?? windowChange)}{" "}
          <span className="text-xs font-normal text-[var(--text-3)]">over {TIMEFRAMES.find((t) => t.key === tf)?.label}</span>
        </span>
        <TimeframeSelector value={tf} onChange={setTf} />
      </div>

      {/* hero: price chart + technical indicators */}
      <section className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[var(--text-3)]">Compare:</span>
            <span className="rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 font-mono text-xs" style={{ color: "#60a5fa" }}>
              {row.symbol}
            </span>
            {compareSymbols.map((s, i) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 font-mono text-xs"
                style={{ color: CMP_COLORS[i % CMP_COLORS.length] }}
              >
                {prettySym(s)}{inverted.has(s) && <span className="text-[10px] opacity-70">inv</span>}
                <button onClick={() => toggleInvert(s)} className="text-[var(--text-3)] hover:text-[var(--text)]" style={inverted.has(s) ? { color: CMP_COLORS[i % CMP_COLORS.length] } : undefined} title="Invert this line (for inverse relationships, e.g. 10Y yield vs REITs)">⇅</button>
                <button onClick={() => removeCompare(s)} className="text-[var(--text-3)] hover:text-[var(--text)]" title="Remove">×</button>
              </span>
            ))}
            <input
              value={compareInput}
              onChange={(e) => setCompareInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addCompare(); }}
              placeholder="+ ticker (KO, CL=F)"
              className="w-32 rounded-md border border-[var(--border)] bg-[var(--bg)] px-2 py-1 text-xs outline-none placeholder:text-[var(--text-4)] focus:border-[var(--border-strong)]"
            />
            {COMPARE_PRESETS.map((p) => (
              <button
                key={p.sym}
                onClick={() => addCompare(p.sym)}
                title={`Overlay ${p.label} (${p.sym})`}
                className="rounded-md border border-dashed border-[var(--border)] bg-[var(--bg)] px-1.5 py-0.5 text-[11px] text-[var(--text-3)] transition-colors hover:border-[var(--border-strong)] hover:text-[var(--text)]"
              >
                +{p.label}
              </button>
            ))}
            {ECON_OVERLAYS.map((o) => (
              <button
                key={o.key}
                onClick={() => addCompare(econSym(o.key))}
                title={`Overlay ${o.label} — FRED economic data`}
                className="rounded-md border border-dotted border-[#a855f7]/50 bg-[var(--bg)] px-1.5 py-0.5 text-[11px] text-[#c4b5fd] transition-colors hover:border-[#a855f7]"
              >
                +{o.label}
              </button>
            ))}
          </div>
          {!comparing && (
            <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--bg)] p-0.5 text-xs font-medium">
              {(["line", "candles"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setChartMode(m)}
                  className={"rounded-md px-2.5 py-1 capitalize transition-colors " + (chartMode === m ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        {comparing ? (
          <CompareChart mainSymbol={row.symbol} mainDaily={daily} mainIntraday={intraday} compareSymbols={compareSymbols} tf={tf} now={now} inverted={inverted} />
        ) : chartMode === "candles" ? (
          <CandleChart symbol={row.symbol} tf={tf} now={now} currency={currency} />
        ) : daily.length === 0 && intraday.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-[var(--text-3)]">No price history for {row.symbol}.</div>
        ) : (
          <IndicatorChart daily={daily} intraday={intraday} tf={tf} now={now} up={(windowChange ?? 0) >= 0} symbol={row.symbol} currency={currency} />
        )}
      </section>

      <div className="mb-5"><KeyStatsStrip stats={stats} row={row} currency={currency} /></div>

      {/* 52-week range */}
      <section className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <div className="mb-1 flex items-center justify-between text-xs text-[var(--text-3)]">
          <span>52-wk low {fmtMoney(row.fiftyTwoWeekLow, currency)}</span>
          <span className="font-semibold text-[var(--text)]">{fmtMoney(row.price, currency)}</span>
          <span>52-wk high {fmtMoney(row.fiftyTwoWeekHigh, currency)}</span>
        </div>
        <div className="relative h-2 rounded-full bg-gradient-to-r from-[#ef4444] via-[#6b7280] to-[#22c55e]">
          <div className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-white shadow" style={{ left: `calc(${pos}% - 2px)` }} />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-[var(--text-3)]">
          <span className="text-[#ef4444]">+{row.pctFromLow.toFixed(1)}% above low</span>
          <span className="text-[#22c55e]">{row.pctFromHigh.toFixed(1)}% from high</span>
        </div>
      </section>

      {/* timeframe returns */}
      <section className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {TIMEFRAMES.map((t) => (
          <button
            key={t.key}
            onClick={() => setTf(t.key)}
            className={"rounded-lg border px-2 py-2 text-center transition-colors " + (t.key === tf ? "border-[var(--accent)] bg-[#2563eb]/15" : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--border-strong)]")}
          >
            <div className="text-[11px] text-[var(--text-3)]">{t.label}</div>
            <div className="mt-0.5 text-sm font-semibold tabular-nums" style={{ color: trendColor(row.returns[t.key]) }}>
              {fmtPct(row.returns[t.key], 1)}
            </div>
          </button>
        ))}
      </section>

      <ExplainMove symbol={row.symbol} name={row.name} returns={row.returns} tf={tf} />

      <section className="mt-5"><BorrowPanel symbol={row.symbol} /></section>
      <section className="mt-5"><SeasonalityPanel daily={daily} /></section>
      <section className="mt-5"><AskAI symbol={row.symbol} name={row.name} /></section>
      <section className="mt-5"><StockExtras symbol={row.symbol} currency={currency} /></section>
      <section className="mt-5"><BriefingTickerNews symbol={row.symbol} name={row.name} /></section>
      <section className="mt-5"><NewsFeed query={row.symbol} title={`${row.symbol} — recent news`} count={10} /></section>
    </div>
  );
}
