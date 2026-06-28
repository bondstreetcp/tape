"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { StockRow } from "@/lib/types";
import type { CatalystMap } from "@/lib/catalysts";
import { TIMEFRAMES, type TimeframeKey } from "@/lib/timeframes";
import { fmtPct } from "@/lib/format";
import { trendColor } from "@/lib/color";

export default function MoversSection({
  universe,
  stocks,
  tf,
  catalysts = {},
}: {
  universe: string;
  stocks: StockRow[];
  tf: TimeframeKey;
  catalysts?: CatalystMap;
}) {
  const router = useRouter();
  const [count, setCount] = useState(6);
  const ranked = [...stocks].filter((s) => s.returns[tf] != null).sort((a, b) => (b.returns[tf] as number) - (a.returns[tf] as number));
  const n = Math.min(count, Math.max(1, Math.floor(ranked.length / 2))); // don't let a name land in both lists on small universes
  const gainers = ranked.slice(0, n);
  const losers = ranked.slice(-n).reverse();
  const tfLabel = TIMEFRAMES.find((t) => t.key === tf)?.label ?? "";

  const Col = ({ title, rows }: { title: string; rows: StockRow[] }) => (
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
      <div className="border-b border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--text-2)]">{title}</div>
      <div className="divide-y divide-[var(--divider)]">
        {rows.map((s) => {
          const why = catalysts[s.symbol]?.why;
          return (
            <div
              key={s.symbol}
              onClick={() => router.push(`/u/${universe}/stock/${encodeURIComponent(s.symbol)}`)}
              className="cursor-pointer px-4 py-2 transition-colors hover:bg-[var(--surface-hover)]"
            >
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono font-semibold">{s.symbol}</span>
                <span className="font-semibold tabular-nums" style={{ color: trendColor(s.returns[tf]) }}>
                  {fmtPct(s.returns[tf], 1)}
                </span>
              </div>
              <div className="truncate text-xs text-[var(--text-3)]">{s.name}</div>
              {why ? (
                <div className="mt-0.5 truncate text-[11px] text-[var(--text-3)]" title={why}>
                  <span className="text-[var(--text-4)]">Why:</span> {why}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );

  if (ranked.length < 2) return null;

  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-[var(--text-2)]">Movers · {tfLabel}</h2>
        <div className="inline-flex rounded-lg border border-[var(--border)] bg-[var(--surface)] p-0.5">
          {[6, 10, 20, 50, 100, 200].map((c) => (
            <button
              key={c}
              onClick={() => setCount(c)}
              className={"rounded-md px-2 py-0.5 text-xs font-medium tabular-nums transition-colors " + (count === c ? "bg-[var(--accent-strong)] text-white" : "text-[var(--text-3)] hover:text-[var(--text)]")}
            >
              {c}
            </button>
          ))}
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <Col title={`▲ Top ${n} gainers`} rows={gainers} />
        <Col title={`▼ Top ${n} losers`} rows={losers} />
      </div>
    </section>
  );
}
