"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { StockRow } from "@/lib/types";
import { TIMEFRAMES } from "@/lib/timeframes";
import { usePersistedTimeframe } from "@/lib/useTimeframe";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { SECTORS, ETF_TO_SECTOR } from "@/lib/sectors";
import { fmtDateTime } from "@/lib/format";
import TimeframeSelector from "./TimeframeSelector";
import UniverseSwitcher from "./UniverseSwitcher";
import Treemap from "./Treemap";

export default function MarketHeatmapView({
  universe,
  stocks,
  generatedAt,
}: {
  universe: string;
  stocks: StockRow[];
  generatedAt: string;
}) {
  const router = useRouter();
  const [tf, setTf] = usePersistedTimeframe(null, "1d");
  const intl = !!UNIVERSE_BY_ID[universe]?.international;
  // Drill-down zoom: all sectors → a sector → a sub-industry. Zooming re-scales the
  // treemap to just that group so the smaller-cap names finally get readable tiles.
  const [zoom, setZoom] = useState<{ sector?: string; industry?: string }>({});

  const sectorOf = (s: StockRow) => (intl ? s.sector || "Other" : ETF_TO_SECTOR[s.etf]?.name ?? s.sector ?? "Other");

  const filtered = useMemo(() => {
    let arr = stocks;
    if (zoom.sector) arr = arr.filter((s) => sectorOf(s) === zoom.sector);
    if (zoom.industry) arr = arr.filter((s) => (s.industry || "Other") === zoom.industry);
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stocks, zoom.sector, zoom.industry, intl]);

  const zoomed = !!(zoom.sector || zoom.industry);
  // Cap only at the top (all-sectors) level; once zoomed, show every name in the group.
  const shown = useMemo(() => {
    if (zoomed || filtered.length <= 500) return filtered;
    return [...filtered].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 500);
  }, [filtered, zoomed]);

  const level = zoom.industry ? 2 : zoom.sector ? 1 : 0;
  const groupBy = level === 0 ? (intl ? "nativeSector" : "sector") : "industry";

  const onGroup = (name: string) => {
    if (level === 0) setZoom({ sector: name });
    else if (level === 1) setZoom({ sector: zoom.sector, industry: name });
  };

  const goSector = (sectorName: string) => {
    const s = SECTORS.find((x) => x.name === sectorName);
    if (s) router.push(`/u/${universe}/sector/${s.etf.toLowerCase()}?tf=${tf}`);
  };

  const crumb = "rounded px-1 transition-colors hover:bg-[var(--surface-hover)] hover:text-[var(--text)]";

  return (
    <main className="mx-auto max-w-[100rem] px-4 py-6 sm:px-6">
      <header className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[var(--text-3)] hover:text-[var(--text)]">
            ← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Market Heatmap</h1>
          {/* breadcrumb / zoom path */}
          <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-[var(--text-3)]">
            <button onClick={() => setZoom({})} className={crumb + (zoomed ? " text-[var(--accent)]" : " font-medium text-[var(--text-2)]")}>
              All sectors
            </button>
            {zoom.sector && (
              <>
                <span className="text-[var(--text-4)]">›</span>
                <button onClick={() => setZoom({ sector: zoom.sector })} className={crumb + (zoom.industry ? " text-[var(--accent)]" : " font-medium text-[var(--text-2)]")}>
                  {zoom.sector}
                </button>
              </>
            )}
            {zoom.industry && (
              <>
                <span className="text-[var(--text-4)]">›</span>
                <span className="px-1 font-medium text-[var(--text-2)]">{zoom.industry}</span>
              </>
            )}
            <span className="ml-1 text-[var(--text-4)]">· {shown.length} names · as of {fmtDateTime(generatedAt)}</span>
            {zoom.sector && !intl && (
              <button onClick={() => goSector(zoom.sector!)} className="ml-1 text-[var(--accent)] hover:underline">open full {zoom.sector} page →</button>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <UniverseSwitcher current={universe} />
          <TimeframeSelector value={tf} onChange={setTf} />
        </div>
      </header>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--bg)] p-2">
        <Treemap
          key={`${zoom.sector ?? ""}|${zoom.industry ?? ""}`}
          stocks={shown}
          tf={tf}
          filter="all"
          threshold={2}
          selected={null}
          onSelect={(s) => {
            if (s) router.push(`/u/${universe}/stock/${encodeURIComponent(s)}`);
          }}
          onIndustryClick={level === 2 ? undefined : onGroup}
          groupBy={groupBy}
        />
      </div>
      <p className="mt-2 text-center text-xs text-[var(--text-3)]">
        {level === 0
          ? "Click a sector label to zoom in"
          : level === 1
            ? "Click a sub-industry label to zoom in further · smaller-cap names are now readable"
            : "Every name in this sub-industry · click the breadcrumb to zoom back out"}{" "}
        · click a tile for the stock · sized by market cap, colored by {TIMEFRAMES.find((t) => t.key === tf)?.label} return.
      </p>
    </main>
  );
}
