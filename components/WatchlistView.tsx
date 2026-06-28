"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { StockRow } from "@/lib/types";
import { TIMEFRAMES, parseTimeframe, type TimeframeKey } from "@/lib/timeframes";
import { usePersistedTimeframe } from "@/lib/useTimeframe";
import { useSearchParams } from "next/navigation";
import { fmtPct, fmtMarketCap, fmtPrice, fmtDateTime } from "@/lib/format";
import { trendColor } from "@/lib/color";
import { ETF_TO_SECTOR } from "@/lib/sectors";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { useWatchlist } from "@/lib/watchlist";
import { useLiveQuotes } from "@/lib/useLiveQuotes";
import { computeSignals, TONE_BG, TONE_FG } from "@/lib/signals";
import TimeframeSelector from "./TimeframeSelector";
import UniverseSwitcher from "./UniverseSwitcher";
import WatchlistDigest from "./WatchlistDigest";

export default function WatchlistView({
  universe,
  stocks,
  generatedAt,
}: {
  universe: string;
  stocks: StockRow[];
  generatedAt: string;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { list, has, toggle } = useWatchlist();
  const [tf, setTf] = usePersistedTimeframe(searchParams.get("tf"), "1d");

  const bySymbol = useMemo(() => {
    const m = new Map<string, StockRow>();
    for (const s of stocks) m.set(s.symbol, s);
    return m;
  }, [stocks]);

  const rows = useMemo(
    () =>
      list
        .map((sym) => bySymbol.get(sym))
        .filter((s): s is StockRow => !!s)
        .sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)),
    [list, bySymbol],
  );

  const missing = list.length - rows.length;

  // Live prices (Yahoo), refreshed on an interval — overrides the nightly snapshot.
  const liveSyms = useMemo(() => rows.map((r) => r.symbol), [rows]);
  const { quotes: live, updatedAt } = useLiveQuotes(liveSyms);
  const sample = Object.values(live).find((q) => q.state);
  const isLive = sample?.state === "REGULAR";
  const stateLabel = !sample
    ? ""
    : sample.state === "REGULAR" ? "Live"
    : sample.state.startsWith("PRE") ? "Pre-market"
    : sample.state.startsWith("POST") ? "After hours"
    : "Market closed";
  const dispPrice = (s: StockRow) => live[s.symbol]?.price ?? s.price;
  const dispChg = (s: StockRow) =>
    tf === "1d" && live[s.symbol]?.changePct != null ? (live[s.symbol]!.changePct as number) : s.returns[tf];

  const summary = useMemo(() => {
    let high = 0, low = 0, below200 = 0, near200 = 0;
    for (const s of rows) {
      const sigs = computeSignals(s);
      if (sigs.some((x) => x.key === "high")) high++;
      if (sigs.some((x) => x.key === "low")) low++;
      if (sigs.some((x) => x.key === "ma200" && x.tone === "down")) below200++;
      if (sigs.some((x) => x.key === "cross")) near200++;
    }
    return { high, low, below200, near200 };
  }, [rows]);

  return (
    <main className="mx-auto max-w-[80rem] px-4 py-6 sm:px-6">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">
            ← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}
          </Link>
          <h1 className="mt-1 text-2xl font-bold">★ Watchlist</h1>
          <p className="mt-1 text-xs text-[var(--text-3)]">
            {rows.length} {rows.length === 1 ? "name" : "names"} · saved in this
            browser · as of {fmtDateTime(generatedAt)}
            {missing > 0 && ` · ${missing} not in ${UNIVERSE_BY_ID[universe]?.short ?? universe} (switch universe to see them)`}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {rows.length > 0 && stateLabel && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--border)] bg-[var(--surface)] px-2.5 py-1 text-xs text-[var(--text-3)]" title={updatedAt ? `Live prices · updated ${new Date(updatedAt).toLocaleTimeString()}` : "Live prices"}>
              <span className={"inline-block h-2 w-2 rounded-full " + (isLive ? "animate-pulse bg-[#22c55e]" : "bg-[var(--text-4)]")} />
              {stateLabel}
            </span>
          )}
          <UniverseSwitcher current={universe} />
          <TimeframeSelector value={tf} onChange={setTf} />
        </div>
      </div>

      {rows.length > 0 && summary.high + summary.low + summary.near200 + summary.below200 > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--text-3)]">Signals:</span>
          {summary.high > 0 && <span className="rounded px-2 py-1" style={{ background: TONE_BG.up, color: TONE_FG.up }}>{summary.high} at/near 52w high</span>}
          {summary.low > 0 && <span className="rounded px-2 py-1" style={{ background: TONE_BG.down, color: TONE_FG.down }}>{summary.low} at/near 52w low</span>}
          {summary.near200 > 0 && <span className="rounded px-2 py-1" style={{ background: TONE_BG.neutral, color: TONE_FG.neutral }}>{summary.near200} near 200d MA</span>}
          {summary.below200 > 0 && <span className="rounded px-2 py-1" style={{ background: TONE_BG.down, color: TONE_FG.down }}>{summary.below200} below 200d MA</span>}
        </div>
      )}

      {rows.length > 0 && <WatchlistDigest rows={rows} />}

      {rows.length === 0 ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-10 text-center">
          <p className="text-sm text-[var(--text-2)]">Your watchlist is empty.</p>
          <p className="mt-1 text-xs text-[var(--text-3)]">
            Add names with the ★ on the{" "}
            <Link href={`/u/${universe}/screener`} className="text-[var(--accent)] hover:underline">
              screener
            </Link>{" "}
            or any stock page.
          </p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <table className="w-full min-w-[760px] text-sm">
            <thead>
              <tr className="border-b border-[var(--border)] text-[var(--text-3)]">
                <th className="sticky left-0 z-10 w-8 bg-[var(--surface)] px-2 py-2"></th>
                <th className="sticky left-8 z-10 bg-[var(--surface)] px-3 py-2 text-left font-medium">Symbol</th>
                <th className="px-3 py-2 text-left font-medium">Name</th>
                <th className="px-3 py-2 text-left font-medium">Sector</th>
                <th className="px-3 py-2 text-right font-medium">Price</th>
                <th className="px-3 py-2 text-right font-medium">{TIMEFRAMES.find((t) => t.key === tf)?.label}</th>
                <th className="px-3 py-2 text-right font-medium">% fr High</th>
                <th className="px-3 py-2 text-right font-medium">% fr Low</th>
                <th className="px-3 py-2 text-right font-medium">Mkt Cap</th>
                <th className="px-3 py-2 text-right font-medium">P/E</th>
                <th className="px-3 py-2 text-left font-medium">Signals</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((s) => (
                <tr
                  key={s.symbol}
                  onClick={() => router.push(`/u/${universe}/stock/${encodeURIComponent(s.symbol)}`)}
                  className="group cursor-pointer border-b border-[var(--divider)] transition-colors hover:bg-[var(--surface-hover)]"
                >
                  <td className="sticky left-0 z-10 bg-[var(--surface)] px-2 py-1.5 text-center transition-colors group-hover:bg-[var(--surface-hover)]">
                    <button
                      onClick={(e) => { e.stopPropagation(); toggle(s.symbol); }}
                      title="Remove from watchlist"
                      style={{ color: "#fbbf24" }}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" stroke="currentColor" strokeWidth="2">
                        <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" strokeLinejoin="round" />
                      </svg>
                    </button>
                  </td>
                  <td className="sticky left-8 z-10 bg-[var(--surface)] px-3 py-1.5 text-left font-mono font-semibold transition-colors group-hover:bg-[var(--surface-hover)]">{s.symbol}</td>
                  <td className="max-w-[16rem] truncate px-3 py-1.5 text-left text-[var(--text-2)]">{s.name}</td>
                  <td className="px-3 py-1.5 text-left text-[var(--text-3)]">{ETF_TO_SECTOR[s.etf]?.name ?? s.sector}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">${fmtPrice(dispPrice(s))}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: trendColor(dispChg(s)) }}>{fmtPct(dispChg(s), 1)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums" style={{ color: trendColor(s.pctFromHigh) }}>{fmtPct(s.pctFromHigh, 1)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtPct(s.pctFromLow, 1)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{fmtMarketCap(s.marketCap)}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{s.trailingPE == null ? "—" : s.trailingPE.toFixed(1)}</td>
                  <td className="px-3 py-1.5 text-left">
                    <div className="flex flex-wrap gap-1">
                      {computeSignals(s).map((sig) => (
                        <span
                          key={sig.key}
                          title={sig.label}
                          className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                          style={{ background: TONE_BG[sig.tone], color: TONE_FG[sig.tone] }}
                        >
                          {sig.short}
                        </span>
                      ))}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
