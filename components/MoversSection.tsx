"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import type { StockRow } from "@/lib/types";
import { TIMEFRAMES, type TimeframeKey } from "@/lib/timeframes";
import { fmtPct } from "@/lib/format";
import { trendColor } from "@/lib/color";

function Headline({ symbol }: { symbol: string }) {
  const [h, setH] = useState<{ title: string; link: string } | null>(null);
  useEffect(() => {
    let alive = true;
    fetch(`/api/news?q=${encodeURIComponent(symbol)}&count=1`)
      .then((r) => r.json())
      .then((d) => alive && setH(d.news?.[0] || null))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [symbol]);
  if (!h) return null;
  return (
    <a
      href={h.link}
      target="_blank"
      rel="noreferrer"
      onClick={(e) => e.stopPropagation()}
      className="mt-0.5 block truncate text-[11px] text-[#8b93a7] hover:text-[#aab2c5]"
      title={h.title}
    >
      › {h.title}
    </a>
  );
}

export default function MoversSection({
  universe,
  stocks,
  tf,
}: {
  universe: string;
  stocks: StockRow[];
  tf: TimeframeKey;
}) {
  const router = useRouter();
  const ranked = [...stocks].filter((s) => s.returns[tf] != null).sort((a, b) => (b.returns[tf] as number) - (a.returns[tf] as number));
  const gainers = ranked.slice(0, 6);
  const losers = ranked.slice(-6).reverse();
  const tfLabel = TIMEFRAMES.find((t) => t.key === tf)?.label ?? "";

  const Col = ({ title, rows }: { title: string; rows: StockRow[] }) => (
    <div className="overflow-hidden rounded-xl border border-[#2a2e39] bg-[#131722]">
      <div className="border-b border-[#2a2e39] px-4 py-2 text-sm font-semibold text-[#aab2c5]">{title}</div>
      <div className="divide-y divide-[#1f2430]">
        {rows.map((s) => (
          <div
            key={s.symbol}
            onClick={() => router.push(`/u/${universe}/stock/${encodeURIComponent(s.symbol)}`)}
            className="cursor-pointer px-4 py-2 transition-colors hover:bg-[#1a1f2e]"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono font-semibold">{s.symbol}</span>
              <span className="font-semibold tabular-nums" style={{ color: trendColor(s.returns[tf]) }}>
                {fmtPct(s.returns[tf], 1)}
              </span>
            </div>
            <div className="truncate text-xs text-[#8b93a7]">{s.name}</div>
            <Headline symbol={s.symbol} />
          </div>
        ))}
      </div>
    </div>
  );

  if (ranked.length < 2) return null;

  return (
    <section className="mt-6">
      <h2 className="mb-2 text-sm font-semibold text-[#aab2c5]">Movers · {tfLabel}</h2>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Col title="▲ Top gainers" rows={gainers} />
        <Col title="▼ Top losers" rows={losers} />
      </div>
    </section>
  );
}
