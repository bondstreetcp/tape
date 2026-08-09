"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useMyNames } from "@/lib/myNames";
import type { WatchlistWireData, WireName } from "@/lib/watchlistWire";

// "Your names" — the watchlist-curated headline feed that leads the Daily Desk's News Wire tab
// (2026-08, Sam). Client-side because the watchlist is client state; the route joins headlines,
// the code-anchored REPORTED fact, catalyst flags, and the 1-day move, ordered most-actionable
// first (fresh prints → big movers → the rest). Quiet names collapse into one line so the wire
// stays scannable.

const pctChip = (v: number | null) =>
  v == null ? null : (
    <span className="font-mono text-xs font-semibold tabular-nums" style={{ color: v >= 0 ? "#22c55e" : "#ef4444" }}>
      {v >= 0 ? "+" : "−"}{Math.abs(v).toFixed(1)}%
    </span>
  );

const CAT_LABEL: Record<string, string> = {
  "acquisition": "BEING ACQUIRED",
  "preannounce": "PREANNOUNCED",
  "spin-off": "SPIN-OFF LIVE",
  "strategic-alt": "STRATEGIC REVIEW",
};

export default function WatchlistWire({ universe }: { universe: string }) {
  const { list, bySymbol } = useMyNames(); // P2: the wire covers the book + the watchlist
  const [data, setData] = useState<WatchlistWireData | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  const joined = useMemo(() => [...list].sort().join(","), [list]);

  useEffect(() => {
    if (!joined) { setData(null); setState("idle"); return; }
    let live = true;
    setState("loading");
    fetch(`/api/watchlist-wire?syms=${encodeURIComponent(joined)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: WatchlistWireData) => { if (live) { setData(j); setState("done"); } })
      .catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [joined]);

  if (!list.length) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center text-sm text-[var(--text-3)]">
        Star names with the <b>☆ Watch</b> button on any stock page (or paste your book into <Link href={`/u/${universe}/portfolio`} className="text-[var(--accent)] hover:underline">Prism</Link>) and their curated headlines lead this tab each morning.
      </div>
    );
  }

  const rows = data?.names ?? [];
  const loud = rows.filter((n) => n.headlines.length || n.reported || n.catalyst || (n.pct1d != null && Math.abs(n.pct1d) >= 2));
  const quiet = rows.filter((n) => !loud.includes(n));

  return (
    <section className="mb-6">
      <div className="mb-2 flex items-baseline justify-between gap-2 border-b border-[var(--divider)] pb-1.5">
        <h2 className="text-lg font-bold text-[var(--text)]">Your names</h2>
        <span className="text-[11px] text-[var(--text-4)]">{list.length} watched · headlines from the last ~3 sessions · a REPORTED badge means a results 8-K is on record</span>
      </div>
      {state === "loading" && !data && <div className="animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-sm text-[var(--text-4)]">Joining your {list.length} names against the wire…</div>}
      {state === "error" && <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-6 text-center text-sm text-[var(--text-3)]">Couldn&apos;t build the watchlist wire just now — the Reuters wire below still works. Try a reload.</div>}
      {state === "done" && (
        <>
          <div className="space-y-2">
            {loud.map((n: WireName) => (
              <div key={n.symbol} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(n.symbol)}`} className="font-mono text-sm font-bold text-[var(--accent)] hover:underline">{n.symbol}</Link>
                  {n.name && <span className="max-w-[16rem] truncate text-xs text-[var(--text-3)]">{n.name}</span>}
                  {pctChip(n.pct1d)}
                  {bySymbol[n.symbol]?.side === "long" && <span className="rounded bg-[#22c55e]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#22c55e]">▲ LONG</span>}
                  {bySymbol[n.symbol]?.side === "short" && <span className="rounded bg-[#ef4444]/15 px-1.5 py-0.5 text-[10px] font-bold text-[#ef4444]">▼ SHORT</span>}
                  {n.reported && (
                    <span className="rounded bg-[color-mix(in_oklab,#f59e0b_18%,transparent)] px-1.5 py-0.5 text-[10px] font-semibold text-[#f59e0b]" title="A results 8-K (Item 2.02) is on record — this print is the context for the name's tape; analyst notes dated after it are reaction, not cause.">
                      REPORTED {n.reported.daysAgo === 0 ? "TODAY" : n.reported.daysAgo === 1 ? "YESTERDAY" : `${n.reported.date} · ${n.reported.daysAgo}d ago`}
                    </span>
                  )}
                  {n.catalyst && CAT_LABEL[n.catalyst.kind] && (
                    <span className="rounded bg-[var(--surface-hover)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--text-2)]" title={`${n.catalyst.headline} (${n.catalyst.date})`}>
                      ⚠ {CAT_LABEL[n.catalyst.kind]}
                    </span>
                  )}
                </div>
                {n.headlines.length > 0 ? (
                  <ul className="mt-1.5 space-y-1">
                    {n.headlines.map((h, i) => (
                      <li key={i} className="text-[13px] leading-snug">
                        {h.link ? (
                          <a href={h.link} target="_blank" rel="noreferrer" className="text-[var(--text)] hover:text-[var(--accent)] hover:underline">{h.title}</a>
                        ) : (
                          <span className="text-[var(--text)]">{h.title}</span>
                        )}
                        <span className="ml-1.5 text-[11px] text-[var(--text-4)]">{h.publisher}{h.date ? ` · ${h.date}` : ""}</span>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="mt-1 text-[12px] text-[var(--text-4)]">No fresh headlines — the move{n.reported ? " reads as the print" : ""} is the story.</div>
                )}
              </div>
            ))}
          </div>
          {quiet.length > 0 && (
            <div className="mt-2 text-[12px] text-[var(--text-4)]">
              Quiet ({quiet.length}): {quiet.map((n, i) => (
                <span key={n.symbol}>
                  {i > 0 && ", "}
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(n.symbol)}`} className="font-mono text-[var(--text-3)] hover:text-[var(--accent)] hover:underline">{n.symbol}</Link>
                </span>
              ))} — no fresh headlines, print, or ≥2% move.
            </div>
          )}
        </>
      )}
    </section>
  );
}
