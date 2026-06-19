"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { MarketGroup, Tile } from "@/lib/market";
import { fmtDateTime } from "@/lib/format";
import NewsFeed from "./NewsFeed";

function fmtPrice(t: Tile): string {
  const p = t.price;
  if (p == null) return "—";
  if (t.kind === "rate") return `${p.toFixed(2)}%`;
  if (t.kind === "fx") return p >= 50 ? p.toFixed(2) : p.toFixed(4);
  if (t.kind === "crypto" || t.kind === "index")
    return p.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return p.toFixed(2);
}
function fmtChange(t: Tile): string {
  if (t.kind === "rate")
    return t.change == null ? "—" : `${t.change >= 0 ? "+" : ""}${(t.change * 100).toFixed(1)} bp`;
  return t.changePct == null ? "—" : `${t.changePct >= 0 ? "+" : ""}${t.changePct.toFixed(2)}%`;
}

function TileCard({ t }: { t: Tile }) {
  const signal = t.kind === "rate" ? t.change : t.changePct;
  const has = signal != null;
  const pos = (signal ?? 0) >= 0;
  const col = !has ? "#8b93a7" : pos ? "#22c55e" : "#ef4444";
  return (
    <div className="rounded-xl border border-[#2a2e39] bg-[#131722] p-3">
      <div className="flex items-baseline justify-between gap-1">
        <span className="truncate text-xs font-medium text-[#aab2c5]">{t.name}</span>
        <span className="shrink-0 font-mono text-[10px] text-[#5b6478]">{t.sym}</span>
      </div>
      <div className="mt-1.5 font-mono text-lg font-semibold tabular-nums text-[#e6e9f0]">{fmtPrice(t)}</div>
      <div className="text-xs font-medium tabular-nums" style={{ color: col }}>
        {has ? (pos ? "▲" : "▼") : ""} {fmtChange(t)}
      </div>
    </div>
  );
}

export default function MarketMonitor({ groups, asOf }: { groups: MarketGroup[]; asOf: string }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const refresh = () => {
    setRefreshing(true);
    router.refresh();
    setTimeout(() => setRefreshing(false), 1200);
  };
  return (
    <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">Market Monitor</h1>
          <p className="mt-1 text-xs text-[#8b93a7]">
            Cross-asset snapshot · indices, rates, FX, commodities &amp; crypto · as of {fmtDateTime(asOf)}
          </p>
        </div>
        <button
          onClick={refresh}
          disabled={refreshing}
          className="rounded-lg border border-[#2a2e39] bg-[#131722] px-3 py-1.5 text-sm text-[#aab2c5] hover:border-[#3a4256] disabled:opacity-50"
        >
          {refreshing ? "Refreshing…" : "↻ Refresh"}
        </button>
      </header>

      {groups.map((g) => (
        <section key={g.name} className="mb-5">
          <h2 className="mb-2 text-sm font-semibold text-[#aab2c5]">{g.name}</h2>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5">
            {g.tiles.map((t) => (
              <TileCard key={t.sym} t={t} />
            ))}
          </div>
        </section>
      ))}

      <section className="mt-6">
        <NewsFeed query="market" title="Market headlines" count={14} />
      </section>

      <p className="mt-2 text-[11px] text-[#5b6478]">
        Quotes via Yahoo (may be delayed). Yields shown as level; change in basis points.
      </p>
    </main>
  );
}
