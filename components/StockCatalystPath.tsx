"use client";
import { useEffect, useState } from "react";
import { CATALYST_META, type StockCatalyst } from "@/lib/catalystPath";

// The forward Catalyst Path for one name — earnings (+ implied move), FDA dates, IPO lockup, investor
// days, ex-div — as a compact timeline. Self-fetches from /api/catalyst-path so the stock page doesn't
// have to thread every feed through. Renders nothing if the name has no dated catalysts ahead.

const dateLabel = (iso: string) => new Date(iso + "T00:00:00Z").toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" });
const clock = (d: number) => (d === 0 ? "today" : d === 1 ? "tomorrow" : `in ${d}d`);

export default function StockCatalystPath({ symbol }: { symbol: string }) {
  const [path, setPath] = useState<StockCatalyst[] | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let live = true;
    fetch(`/api/catalyst-path/${encodeURIComponent(symbol)}`)
      .then((r) => r.json())
      .then((d) => { if (live) { setPath(Array.isArray(d?.path) ? d.path : []); setLoaded(true); } })
      .catch(() => { if (live) { setPath([]); setLoaded(true); } });
    return () => { live = false; };
  }, [symbol]);

  if (!loaded || !path || path.length === 0) return null; // nothing dated ahead → don't take up space

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-[var(--text)]">Catalyst path</h3>
        <span className="text-[11px] text-[var(--text-4)]">what moves {symbol} next</span>
      </div>
      <ol className="relative space-y-3 border-l border-[var(--divider)] pl-4">
        {path.slice(0, 8).map((e, i) => {
          const m = CATALYST_META[e.kind];
          const soon = e.daysTo <= 14;
          return (
            <li key={i} className="relative">
              <span className="absolute -left-[21px] top-1 h-2.5 w-2.5 rounded-full border-2 border-[var(--surface)]" style={{ background: m.color }} aria-hidden />
              <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <span className="rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide" style={{ color: m.color, background: `color-mix(in oklab, ${m.color} 15%, transparent)` }}>{m.label}</span>
                <span className="text-[13px] font-medium text-[var(--text)]">{e.label}</span>
                {e.movePct != null && <span className="font-mono text-[12px] text-[var(--text-3)]">±{e.movePct.toFixed(1)}%</span>}
                <span className="ml-auto whitespace-nowrap text-[12px] text-[var(--text-3)]">{dateLabel(e.date)} <b style={{ color: soon ? "#f59e0b" : "var(--text-4)" }}>· {clock(e.daysTo)}</b></span>
              </div>
              {e.detail && (
                <div className="mt-0.5 text-[12px] text-[var(--text-4)]">
                  {e.url ? <a href={e.url} target="_blank" rel="noreferrer" className="hover:text-[var(--accent)] hover:underline">{e.detail} ↗</a> : e.detail}
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="mt-3 text-[10px] leading-relaxed text-[var(--text-4)]">
        Forward dated catalysts stitched from the app&apos;s event feeds — earnings (options-implied move), FDA action dates &amp; clinical readouts, IPO lockup expiry, investor days, and ex-dividend. Dates are estimates from public data; not advice.
      </p>
    </div>
  );
}
