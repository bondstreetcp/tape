"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { StockRow } from "@/lib/types";
import { TIMEFRAMES, type TimeframeKey } from "@/lib/timeframes";
import { UNIVERSE_BY_ID } from "@/lib/universes";
import { SECTORS } from "@/lib/sectors";
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
  const [tf, setTf] = useState<TimeframeKey>("1d");

  // Cap very large universes to the top names by cap so the map stays legible.
  const shown = useMemo(() => {
    if (stocks.length <= 500) return stocks;
    return [...stocks].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 500);
  }, [stocks]);

  const goSector = (sectorName: string) => {
    const s = SECTORS.find((x) => x.name === sectorName);
    if (s) router.push(`/u/${universe}/sector/${s.etf.toLowerCase()}?tf=${tf}`);
  };

  return (
    <main className="mx-auto max-w-[100rem] px-4 py-6 sm:px-6">
      <header className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href={`/u/${universe}`} className="text-sm text-[#8b93a7] hover:text-[#e6e9f0]">
            ← {UNIVERSE_BY_ID[universe]?.name ?? "Home"}
          </Link>
          <h1 className="mt-1 text-2xl font-bold">Market Heatmap</h1>
          <p className="mt-1 text-xs text-[#8b93a7]">
            {shown.length} names
            {stocks.length > shown.length ? ` (top ${shown.length} by cap of ${stocks.length})` : ""} · grouped by
            sector · as of {fmtDateTime(generatedAt)}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <UniverseSwitcher current={universe} />
          <TimeframeSelector value={tf} onChange={setTf} />
        </div>
      </header>

      <div className="rounded-xl border border-[#2a2e39] bg-[#0b0e14] p-2">
        <Treemap
          stocks={shown}
          tf={tf}
          filter="all"
          threshold={2}
          selected={null}
          onSelect={(s) => {
            if (s) router.push(`/u/${universe}/stock/${encodeURIComponent(s)}`);
          }}
          onIndustryClick={goSector}
          groupBy="sector"
        />
      </div>
      <p className="mt-2 text-center text-xs text-[#8b93a7]">
        Click a sector label to open it · click a tile for the stock · sized by market cap, colored by{" "}
        {TIMEFRAMES.find((t) => t.key === tf)?.label} return.
      </p>
    </main>
  );
}
