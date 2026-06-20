"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import type { StockRow } from "@/lib/types";
import type { TimeframeKey } from "@/lib/timeframes";
import { trendColor } from "@/lib/color";
import { fmtPct } from "@/lib/format";

interface Action { date: string; firm: string; action: string; toGrade: string; targetTo: number | null; symbol: string }
interface NewsI { title: string; publisher: string; link: string; time: string | null }

const ACTION: Record<string, { l: string; c: string }> = {
  up: { l: "Upgrade", c: "#22c55e" }, down: { l: "Downgrade", c: "#ef4444" },
  init: { l: "Initiate", c: "#60a5fa" }, reit: { l: "Reiterate", c: "var(--text-3)" }, main: { l: "Maintain", c: "var(--text-3)" },
};
const actionMeta = (a: string) => ACTION[a] || { l: a || "Update", c: "var(--text-3)" };
const Muted = ({ children }: { children: React.ReactNode }) => <div className="py-2 text-xs text-[var(--text-3)]">{children}</div>;

export default function IndustryExtras({ stocks, tf, universe, label }: { stocks: StockRow[]; tf: TimeframeKey; universe: string; label: string }) {
  const [feed, setFeed] = useState<{ news: NewsI[]; actions: Action[] } | null>(null);

  useEffect(() => {
    let on = true;
    setFeed(null);
    const tickers = [...stocks].sort((a, b) => (b.marketCap || 0) - (a.marketCap || 0)).slice(0, 12).map((s) => s.symbol).join(",");
    fetch(`/api/industry-feed?tickers=${encodeURIComponent(tickers)}`)
      .then((r) => r.json())
      .then((d) => on && setFeed({ news: d.news || [], actions: d.actions || [] }))
      .catch(() => on && setFeed({ news: [], actions: [] }));
    return () => { on = false; };
  }, [stocks]);

  const gainers = [...stocks].filter((s) => s.returns[tf] != null).sort((a, b) => (b.returns[tf] as number) - (a.returns[tf] as number)).slice(0, 8);

  return (
    <div className="space-y-3">
      <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
        <h3 className="mb-2 text-sm font-semibold text-[var(--text-2)]">Top gainers · {label}</h3>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {gainers.map((s) => (
            <Link key={s.symbol} href={`/u/${universe}/stock/${encodeURIComponent(s.symbol)}`} className="rounded-lg border border-[var(--divider)] bg-[var(--surface-2)] px-2.5 py-2 hover:border-[var(--border-strong)]">
              <div className="flex items-center justify-between gap-1">
                <span className="font-mono text-sm font-semibold">{s.symbol}</span>
                <span className="text-sm font-semibold tabular-nums" style={{ color: trendColor(s.returns[tf]) }}>{fmtPct(s.returns[tf], 1)}</span>
              </div>
              <div className="truncate text-[11px] text-[var(--text-3)]">{s.name}</div>
            </Link>
          ))}
          {gainers.length === 0 && <Muted>No data.</Muted>}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 text-sm font-semibold text-[var(--text-2)]">Recent analyst actions · {label}</h3>
          {!feed ? <Muted>Loading…</Muted> : feed.actions.length === 0 ? <Muted>No recent rating changes.</Muted> : (
            <div className="max-h-[320px] space-y-0.5 overflow-y-auto">
              {feed.actions.map((c, i) => {
                const m = actionMeta(c.action);
                return (
                  <div key={i} className="flex items-center gap-2 border-t border-[var(--divider)] py-1 text-xs">
                    <span className="w-[58px] shrink-0 tabular-nums text-[var(--text-3)]">{c.date}</span>
                    <Link href={`/u/${universe}/stock/${encodeURIComponent(c.symbol)}`} className="w-[50px] shrink-0 font-mono font-semibold hover:underline">{c.symbol}</Link>
                    <span className="flex-1 truncate text-[var(--text-3)]">{c.firm}</span>
                    <span className="shrink-0 font-medium" style={{ color: m.c }}>{m.l}</span>
                    <span className="w-[92px] shrink-0 truncate text-right text-[var(--text-2)]">{c.toGrade}{c.targetTo != null ? ` · $${c.targetTo.toFixed(0)}` : ""}</span>
                  </div>
                );
              })}
            </div>
          )}
        </section>

        <section className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
          <h3 className="mb-2 text-sm font-semibold text-[var(--text-2)]">Constituent news · {label}</h3>
          {!feed ? <Muted>Loading…</Muted> : feed.news.length === 0 ? <Muted>No recent news.</Muted> : (
            <div className="max-h-[320px] space-y-2 overflow-y-auto">
              {feed.news.map((n, i) => (
                <a key={i} href={n.link} target="_blank" rel="noreferrer" className="block hover:opacity-80">
                  <div className="text-[13px] leading-snug text-[var(--text-body)]">{n.title}</div>
                  <div className="text-[11px] text-[var(--text-4)]">{n.publisher}{n.time ? ` · ${new Date(n.time).toLocaleDateString(undefined, { month: "short", day: "numeric" })}` : ""}</div>
                </a>
              ))}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
