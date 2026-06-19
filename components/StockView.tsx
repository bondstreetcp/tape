"use client";
import { useMemo, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import type { SeriesPoint, StockRow } from "@/lib/types";
import { TIMEFRAMES, type TimeframeKey } from "@/lib/timeframes";
import { usePersistedTimeframe } from "@/lib/useTimeframe";
import { sliceSeries, seriesChangePct } from "@/lib/compute";
import { slugify } from "@/lib/slug";
import { trendColor } from "@/lib/color";
import { fmtPct, fmtPrice, fmtMarketCap, fmtDateTime } from "@/lib/format";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import TimeframeSelector from "./TimeframeSelector";
import UniverseSwitcher from "./UniverseSwitcher";
import WatchStar from "./WatchStar";
import NewsFeed from "./NewsFeed";

const IndicatorChart = dynamic(() => import("./IndicatorChart"), { ssr: false });
const CandleChart = dynamic(() => import("./CandleChart"), { ssr: false });
const CompareChart = dynamic(() => import("./CompareChart"), { ssr: false });

export default function StockView({
  universe,
  row,
  sectorName,
  daily,
  intraday,
  generatedAt,
}: {
  universe: string;
  row: StockRow;
  sectorName: string;
  daily: SeriesPoint[];
  intraday: SeriesPoint[];
  generatedAt: string;
}) {
  const [tf, setTf] = usePersistedTimeframe(null, "1y");
  const [chartMode, setChartMode] = useState<"line" | "candles">("line");
  const [compareSymbols, setCompareSymbols] = useState<string[]>([]);
  const [compareInput, setCompareInput] = useState("");
  const now = useMemo(() => Date.parse(generatedAt) || Date.now(), [generatedAt]);

  const addCompare = () => {
    const s = compareInput.trim().toUpperCase().replace(/[^A-Z0-9.-]/g, "");
    if (s && s !== row.symbol && !compareSymbols.includes(s) && compareSymbols.length < 5) {
      setCompareSymbols((p) => [...p, s]);
    }
    setCompareInput("");
  };
  const removeCompare = (s: string) => setCompareSymbols((p) => p.filter((x) => x !== s));
  const comparing = compareSymbols.length > 0;
  const CMP_COLORS = ["#f472b6", "#fbbf24", "#4ade80", "#c084fc", "#fb923c"];

  const windowChange = useMemo(() => {
    const pts = sliceSeries(intraday, daily, tf, now);
    return seriesChangePct(pts);
  }, [intraday, daily, tf, now]);

  const span = row.fiftyTwoWeekHigh - row.fiftyTwoWeekLow;
  const pos =
    span > 0
      ? Math.min(100, Math.max(0, ((row.price - row.fiftyTwoWeekLow) / span) * 100))
      : 50;

  return (
    <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Link
              href={`/u/${universe}/sector/${row.etf.toLowerCase()}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2a2e39] bg-[#131722] px-3 py-1.5 text-sm font-medium text-[#aab2c5] transition-colors hover:border-[#3a4256] hover:text-[#e6e9f0]"
            >
              ← {row.etf} {sectorName} heatmap
            </Link>
            <Link
              href={`/u/${universe}/sector/${row.etf.toLowerCase()}/${slugify(row.industry)}`}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[#2a2e39] bg-[#131722] px-3 py-1.5 text-sm font-medium text-[#aab2c5] transition-colors hover:border-[#3a4256] hover:text-[#e6e9f0]"
            >
              ⇄ {row.industry} peers
            </Link>
          </div>
          <div className="flex flex-wrap items-center gap-2 text-sm text-[#8b93a7]">
            <Link href={`/u/${universe}`} className="hover:text-[#e6e9f0]">
              {UNIVERSE_BY_ID[universe]?.name ?? "Sectors"}
            </Link>
            <span>/</span>
            <Link
              href={`/u/${universe}/sector/${row.etf.toLowerCase()}`}
              className="hover:text-[#e6e9f0]"
            >
              {row.etf} {sectorName}
            </Link>
            <span>/</span>
            <Link
              href={`/u/${universe}/sector/${row.etf.toLowerCase()}/${slugify(row.industry)}`}
              className="hover:text-[#e6e9f0]"
            >
              {row.industry}
            </Link>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-3">
            <h1 className="font-mono text-2xl font-bold">{row.symbol}</h1>
            <span className="text-lg text-[#aab2c5]">{row.name}</span>
            <span className="font-mono text-xl tabular-nums">${fmtPrice(row.price)}</span>
            <span
              className="text-lg font-semibold tabular-nums"
              style={{ color: trendColor(windowChange ?? row.returns[tf]) }}
            >
              {fmtPct(windowChange ?? row.returns[tf])}{" "}
              <span className="text-xs font-normal text-[#8b93a7]">
                {TIMEFRAMES.find((t) => t.key === tf)?.label}
              </span>
            </span>
          </div>
          <p className="mt-1 text-xs text-[#8b93a7]">
            {fmtMarketCap(row.marketCap)} cap · as of {fmtDateTime(generatedAt)}
          </p>
          <Link
            href={`/u/${universe}/stock/${encodeURIComponent(row.symbol)}/financials`}
            className="mt-2 inline-flex items-center gap-1.5 rounded-lg border border-[#2563eb]/50 bg-[#2563eb]/15 px-3 py-1.5 text-sm font-medium text-[#93c5fd] transition-colors hover:bg-[#2563eb]/25"
          >
            ▦ Quarterly &amp; annual financials →
          </Link>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <WatchStar symbol={row.symbol} withLabel />
          <UniverseSwitcher current={universe} etf={row.etf} />
          <TimeframeSelector value={tf} onChange={setTf} />
        </div>
      </div>

      {/* hero: price chart + technical indicators */}
      <section className="mb-5 rounded-xl border border-[#2a2e39] bg-[#131722] p-4">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-[#8b93a7]">Compare:</span>
            <span className="rounded-md border border-[#2a2e39] bg-[#0b0e14] px-1.5 py-0.5 font-mono text-xs" style={{ color: "#60a5fa" }}>
              {row.symbol}
            </span>
            {compareSymbols.map((s, i) => (
              <span
                key={s}
                className="inline-flex items-center gap-1 rounded-md border border-[#2a2e39] bg-[#0b0e14] px-1.5 py-0.5 font-mono text-xs"
                style={{ color: CMP_COLORS[i % CMP_COLORS.length] }}
              >
                {s}
                <button onClick={() => removeCompare(s)} className="text-[#8b93a7] hover:text-[#e6e9f0]" title="Remove">×</button>
              </span>
            ))}
            <input
              value={compareInput}
              onChange={(e) => setCompareInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") addCompare(); }}
              placeholder="+ ticker (e.g. KO)"
              className="w-32 rounded-md border border-[#2a2e39] bg-[#0b0e14] px-2 py-1 text-xs outline-none placeholder:text-[#5b6478] focus:border-[#3a4256]"
            />
          </div>
          {!comparing && (
            <div className="inline-flex rounded-lg border border-[#2a2e39] bg-[#0b0e14] p-0.5 text-xs font-medium">
              {(["line", "candles"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setChartMode(m)}
                  className={
                    "rounded-md px-2.5 py-1 capitalize transition-colors " +
                    (chartMode === m ? "bg-[#2563eb] text-white" : "text-[#8b93a7] hover:text-[#e6e9f0]")
                  }
                >
                  {m}
                </button>
              ))}
            </div>
          )}
        </div>
        {comparing ? (
          <CompareChart
            mainSymbol={row.symbol}
            mainDaily={daily}
            mainIntraday={intraday}
            compareSymbols={compareSymbols}
            tf={tf}
            now={now}
          />
        ) : chartMode === "candles" ? (
          <CandleChart symbol={row.symbol} tf={tf} now={now} />
        ) : daily.length === 0 && intraday.length === 0 ? (
          <div className="flex h-[300px] items-center justify-center text-sm text-[#8b93a7]">
            No price history for {row.symbol}.
          </div>
        ) : (
          <IndicatorChart
            daily={daily}
            intraday={intraday}
            tf={tf}
            now={now}
            up={(windowChange ?? 0) >= 0}
            symbol={row.symbol}
          />
        )}
      </section>

      {/* 52-week range */}
      <section className="mb-5 rounded-xl border border-[#2a2e39] bg-[#131722] p-4">
        <div className="mb-1 flex items-center justify-between text-xs text-[#8b93a7]">
          <span>52-wk low ${fmtPrice(row.fiftyTwoWeekLow)}</span>
          <span className="font-semibold text-[#e6e9f0]">${fmtPrice(row.price)}</span>
          <span>52-wk high ${fmtPrice(row.fiftyTwoWeekHigh)}</span>
        </div>
        <div className="relative h-2 rounded-full bg-gradient-to-r from-[#ef4444] via-[#6b7280] to-[#22c55e]">
          <div
            className="absolute top-1/2 h-4 w-1 -translate-y-1/2 rounded-full bg-white shadow"
            style={{ left: `calc(${pos}% - 2px)` }}
          />
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-[#8b93a7]">
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
            className={
              "rounded-lg border px-2 py-2 text-center transition-colors " +
              (t.key === tf
                ? "border-[#2563eb] bg-[#2563eb]/15"
                : "border-[#2a2e39] bg-[#0b0e14] hover:border-[#3a4256]")
            }
          >
            <div className="text-[11px] text-[#8b93a7]">{t.label}</div>
            <div
              className="mt-0.5 text-sm font-semibold tabular-nums"
              style={{ color: trendColor(row.returns[t.key]) }}
            >
              {fmtPct(row.returns[t.key], 1)}
            </div>
          </button>
        ))}
      </section>

      {/* news */}
      <section className="mt-5">
        <NewsFeed query={row.symbol} title={`${row.symbol} — recent news`} count={10} />
      </section>
    </main>
  );
}
