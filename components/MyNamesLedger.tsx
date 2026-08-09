"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useWatchlist } from "@/lib/watchlist";
import { rankOf, type LedgerData, type LedgerEvent, type LedgerKind, type LedgerName } from "@/lib/myNamesLedger";

// My Names — Change Ledger (P1). Client-side because the list is client state; the route joins.
// The "since you last looked" cursor is per-browser (localStorage) — read BEFORE it's advanced,
// so this visit's NEW badges reflect the PREVIOUS visit's cutoff. Honest limitation (stated in
// the footer): the cursor doesn't follow you across devices until accounts unshelve.

const SEEN_KEY = "myNames.lastSeen";

const KIND_CHIP: Record<LedgerKind, { label: string; cls: string }> = {
  reported: { label: "REPORTED", cls: "bg-[#f59e0b]/18 text-[#f59e0b]" },
  preannounce: { label: "PREANNOUNCED", cls: "bg-[#f59e0b]/18 text-[#f59e0b]" },
  deal: { label: "DEAL", cls: "bg-[#a78bfa]/18 text-[#a78bfa]" },
  review: { label: "STRATEGIC REVIEW", cls: "bg-[#a78bfa]/18 text-[#a78bfa]" },
  spin: { label: "SPIN-OFF", cls: "bg-[#a78bfa]/18 text-[#a78bfa]" },
  "earnings-ahead": { label: "REPORTS SOON", cls: "bg-[var(--accent-soft)] text-[var(--accent)]" },
  filing: { label: "FILING", cls: "bg-[#22d3ee]/15 text-[#22d3ee]" },
  insider: { label: "INSIDER BUYS", cls: "bg-[#22c55e]/15 text-[#22c55e]" },
  shorts: { label: "SHORT STRESS", cls: "bg-[#ef4444]/15 text-[#ef4444]" },
  borrow: { label: "BORROW", cls: "bg-[#ef4444]/15 text-[#ef4444]" },
  estimate: { label: "ESTIMATES", cls: "bg-[var(--surface-hover)] text-[var(--text-2)]" },
  options: { label: "OPTIONS FLOW", cls: "bg-[var(--surface-hover)] text-[var(--text-2)]" },
  headline: { label: "NEWS", cls: "bg-[var(--surface-hover)] text-[var(--text-3)]" },
};

const pctChip = (v: number | null) =>
  v == null ? null : (
    <span className="font-mono text-xs font-semibold tabular-nums" style={{ color: v >= 0 ? "#22c55e" : "#ef4444" }}>
      {v >= 0 ? "+" : "−"}{Math.abs(v).toFixed(1)}%
    </span>
  );

export default function MyNamesLedger({ universe }: { universe: string }) {
  const { list } = useWatchlist();
  const [data, setData] = useState<LedgerData | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle");
  // Previous visit's cursor, captured once on mount before this visit advances it.
  const prevSeenRef = useRef<number | null>(null);
  const [prevSeen, setPrevSeen] = useState<number | null>(null);
  const joined = useMemo(() => [...list].sort().join(","), [list]);

  useEffect(() => {
    if (prevSeenRef.current == null) {
      const raw = typeof window !== "undefined" ? window.localStorage.getItem(SEEN_KEY) : null;
      const ms = raw ? Date.parse(raw) : NaN;
      prevSeenRef.current = Number.isFinite(ms) ? ms : 0;
      setPrevSeen(prevSeenRef.current);
    }
  }, []);

  useEffect(() => {
    if (!joined) { setData(null); setState("idle"); return; }
    let live = true;
    setState("loading");
    fetch(`/api/my-names-ledger?syms=${encodeURIComponent(joined)}`)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((j: LedgerData) => {
        if (!live) return;
        setData(j);
        setState("done");
        try { window.localStorage.setItem(SEEN_KEY, new Date().toISOString()); } catch { /* cosmetic */ }
      })
      .catch(() => { if (live) setState("error"); });
    return () => { live = false; };
  }, [joined]);

  const isNew = (e: LedgerEvent) => {
    if (prevSeen == null || prevSeen === 0) return false; // first ever visit: nothing is "new", everything is
    const ms = Date.parse(e.ts);
    return Number.isFinite(ms) && ms > prevSeen;
  };
  const href = (h?: string) => (h ? (h.startsWith("http") ? h : `/u/${universe}${h}`) : null);

  if (!list.length) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--text-3)]">
        Nothing to monitor yet — star names with the <b>☆ Watch</b> button on any stock page (or from the <Link href={`/u/${universe}/watchlist`} className="text-[var(--accent)] hover:underline">Watchlist</Link>) and every change in them lands here.
      </div>
    );
  }

  const rows = data?.names ?? [];
  const loud = rows.filter((n) => n.events.length > 0);
  const quiet = rows.filter((n) => n.events.length === 0);
  const newCount = loud.reduce((a, n) => a + n.events.filter(isNew).length, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-2 text-[12px] text-[var(--text-4)]">
        <span>{list.length} names monitored</span>
        {prevSeen ? <span>· last looked {new Date(prevSeen).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</span> : null}
        {state === "done" && newCount > 0 && <span className="rounded bg-[var(--accent-soft)] px-1.5 py-0.5 font-semibold text-[var(--accent)]">{newCount} new since then</span>}
      </div>

      {state === "loading" && !data && <div className="animate-pulse rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-10 text-center text-sm text-[var(--text-4)]">Joining {list.length} names against the feeds…</div>}
      {state === "error" && <div className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-8 text-center text-sm text-[var(--text-3)]">Couldn&apos;t build the ledger just now — try a reload.</div>}

      {state === "done" && (
        <>
          <div className="space-y-2.5">
            {loud.map((n: LedgerName) => (
              <div key={n.symbol} className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-3.5 py-2.5">
                <div className="flex flex-wrap items-center gap-2">
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(n.symbol)}`} className="font-mono text-sm font-bold text-[var(--accent)] hover:underline">{n.symbol}</Link>
                  {n.name && <span className="max-w-[18rem] truncate text-xs text-[var(--text-3)]">{n.name}</span>}
                  {pctChip(n.pct1d)}
                </div>
                <ul className="mt-1.5 space-y-1">
                  {n.events.map((e, i) => {
                    const chip = KIND_CHIP[e.kind] ?? KIND_CHIP.headline;
                    const h = href(e.href);
                    return (
                      <li key={i} className="flex flex-wrap items-baseline gap-1.5 text-[13px] leading-snug">
                        {isNew(e) && <span className="rounded bg-[var(--accent-strong)] px-1 py-0.5 text-[9px] font-bold text-white">NEW</span>}
                        <span className={"rounded px-1.5 py-0.5 text-[10px] font-semibold " + chip.cls}>{chip.label}</span>
                        {h ? (
                          h.startsWith("http") ? (
                            <a href={h} target="_blank" rel="noreferrer" className="text-[var(--text)] hover:text-[var(--accent)] hover:underline">{e.title}</a>
                          ) : (
                            <Link href={h} className="text-[var(--text)] hover:text-[var(--accent)] hover:underline">{e.title}</Link>
                          )
                        ) : (
                          <span className="text-[var(--text)]">{e.title}</span>
                        )}
                        {e.detail && <span className="text-[11px] text-[var(--text-4)]">{e.detail}</span>}
                        {e.ts && <span className="text-[11px] text-[var(--text-4)]">· {e.ts.slice(0, 10)}</span>}
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
          {quiet.length > 0 && (
            <div className="mt-2.5 text-[12px] text-[var(--text-4)]">
              Quiet ({quiet.length}): {quiet.map((n, i) => (
                <span key={n.symbol}>
                  {i > 0 && ", "}
                  <Link href={`/u/${universe}/stock/${encodeURIComponent(n.symbol)}`} className="font-mono text-[var(--text-3)] hover:text-[var(--accent)] hover:underline">{n.symbol}</Link>
                </span>
              ))} — no ledger events.
            </div>
          )}
          <p className="mt-4 text-[11px] text-[var(--text-4)]">
            Every event links to its source — the ledger is a code-level join over the app&apos;s existing feeds (no AI in this path). The &quot;new&quot; cursor is per-browser. Decision-support, not advice.
          </p>
        </>
      )}
    </div>
  );
}
